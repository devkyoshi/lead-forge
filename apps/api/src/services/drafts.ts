import type { Campaign, Lead, Prisma } from "@prisma/client";
import {
  DEFAULT_TEMPLATES,
  markdownToHtml,
  renderTemplate,
  validateAiSentences,
  type Tone,
  type TemplateVars,
} from "@leadforge/shared";
import { prisma } from "../db.js";
import { unsubscribeUrl } from "../lib/unsub.js";
import { createAiProvider, factBasedNote, type AiProvider } from "../providers/ai.js";
import { HttpError } from "./leads.js";

type Scenario = "NO_WEBSITE" | "POOR_WEBSITE" | "FOLLOWUP_1" | "FOLLOWUP_2";

/** Creates the four default templates (version 1) if the workspace has none. */
export async function ensureDefaultTemplates(workspaceId: string) {
  if ((await prisma.emailTemplate.count({ where: { workspaceId } })) > 0) return;
  for (const t of DEFAULT_TEMPLATES) {
    await createTemplate(workspaceId, t, "system");
  }
}

export async function createTemplate(
  workspaceId: string,
  t: { name: string; category: string; scenario: Scenario; subject: string; body: string },
  createdBy: string,
) {
  return prisma.$transaction(async (tx) => {
    const tpl = await tx.emailTemplate.create({
      data: { workspaceId, name: t.name, category: t.category, scenario: t.scenario },
    });
    const v = await tx.emailTemplateVersion.create({
      data: { workspaceId, templateId: tpl.id, version: 1, subject: t.subject, bodyMd: t.body, createdBy },
    });
    return tx.emailTemplate.update({ where: { id: tpl.id }, data: { currentVersionId: v.id }, include: { versions: true } });
  });
}

export function scenarioForLead(lead: Pick<Lead, "websiteStatus">): Scenario {
  return lead.websiteStatus === "NO_WEBSITE" || lead.websiteStatus === "SOCIAL_ONLY" ? "NO_WEBSITE" : "POOR_WEBSITE";
}

/** Picks the category-specific template if one exists, else the generic one, for the scenario. */
export async function pickTemplate(workspaceId: string, scenario: Scenario, category: string | null, templateId?: string | null) {
  const where = { workspaceId, archived: false, currentVersionId: { not: null } };
  if (templateId) {
    const t = await prisma.emailTemplate.findFirst({ where: { ...where, id: templateId } });
    if (t) return t;
  }
  const candidates = await prisma.emailTemplate.findMany({ where: { ...where, scenario }, orderBy: { createdAt: "asc" } });
  const cat = category?.toLowerCase();
  return candidates.find((t) => cat && t.category.toLowerCase() === cat) ?? candidates.find((t) => t.category === "generic") ?? candidates[0] ?? null;
}

export function websiteIssuesText(lead: Pick<Lead, "websiteStatus">, issues: string[]): string {
  switch (lead.websiteStatus) {
    case "NO_WEBSITE":
      return "I could not find a website for you online.";
    case "SOCIAL_ONLY":
      return "I could only find a social media page for you, not a website of your own.";
    case "BROKEN":
      return `Your website does not seem to load properly (${issues[0] ?? "it could not be reached"}).`;
    default:
      return issues.length ? `${issues.slice(0, 3).join("; ")}.` : "";
  }
}

function factSheet(lead: Lead, issues: string[]): string {
  return [
    `Business name: ${lead.name}`,
    lead.category ? `Category: ${lead.category}` : null,
    lead.area ? `Area: ${lead.area}` : null,
    lead.rating != null ? `Google rating: ${lead.rating}` : null,
    lead.reviewCount != null ? `Number of reviews: ${lead.reviewCount}` : null,
    `Website status: ${lead.websiteStatus}`,
    issues.length ? `Website issues found: ${issues.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface BuiltEmail {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variables: Record<string, string>;
  aiGenerated: boolean;
  aiNote?: string;
  warnings: string[];
}

export async function buildEmail(opts: {
  lead: Lead;
  subjectTpl: string;
  bodyTpl: string;
  tone: Tone;
  aiPersonalize: boolean;
  ai?: AiProvider;
}): Promise<BuiltEmail> {
  const { lead } = opts;
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: lead.workspaceId } });
  const audit = await prisma.leadAudit.findFirst({ where: { leadId: lead.id }, orderBy: { version: "desc" } });
  const issues = ((audit?.issues ?? []) as { message: string }[]).map((i) => i.message);
  const warnings: string[] = [];

  let aiNote = "";
  let aiGenerated = false;
  const facts = {
    businessName: lead.name,
    category: lead.category,
    area: lead.area,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    websiteStatus: lead.websiteStatus,
    websiteIssues: issues,
  };
  if (opts.aiPersonalize) {
    const sheet = factSheet(lead, issues);
    try {
      const sentences = await (opts.ai ?? createAiProvider()).personalize({ tone: opts.tone, facts, factSheet: sheet });
      const checked = validateAiSentences(sentences, sheet);
      if (checked.ok) {
        aiNote = checked.sentences.join(" ");
        aiGenerated = true;
      } else {
        warnings.push(`AI note rejected (${checked.reason}); used fact-based note`);
        aiNote = factBasedNote(facts).join(" ");
      }
    } catch (e) {
      warnings.push(`AI unavailable (${(e as Error).message}); used fact-based note`);
      aiNote = factBasedNote(facts).join(" ");
    }
  }

  const vars: TemplateVars = {
    business_name: lead.name,
    owner_name: null,
    category: lead.category,
    area: lead.area,
    website_issues: websiteIssuesText(lead, issues),
    ai_note: aiNote,
    rating: lead.rating,
    review_count: lead.reviewCount,
    sender_name: ws.senderName,
    sender_company: ws.senderCompany,
    portfolio_link: ws.portfolioLink,
    unsubscribe_link: unsubscribeUrl(lead.workspaceId, lead.id),
  };

  const subject = renderTemplate(opts.subjectTpl, vars);
  const body = renderTemplate(opts.bodyTpl, vars);
  // Compliance footer: sender identity + physical address on every email.
  const footer = [ws.senderCompany ?? ws.name, ws.senderAddress].filter(Boolean).join(", ");
  if (!ws.senderAddress) warnings.push("Workspace has no physical address set (required before sending)");
  const bodyText = footer ? `${body.text}\n\n${footer}` : body.text;
  for (const m of [...subject.missing, ...body.missing]) if (m !== "ai_note") warnings.push(`Variable {{${m}}} has no value`);

  return {
    subject: subject.text.replace(/\s*\n\s*/g, " "),
    bodyText,
    bodyHtml: markdownToHtml(bodyText),
    variables: { ...body.used, ...subject.used },
    aiGenerated,
    aiNote: aiNote || undefined,
    warnings,
  };
}

/** Creates (or returns the existing) step-0 draft for a lead in a campaign. Idempotent per (lead, campaign, step). */
export async function generateDraft(opts: {
  lead: Lead;
  campaign: Campaign | null;
  runId?: string;
  ai?: AiProvider;
  force?: boolean;
}) {
  const { lead, campaign } = opts;
  const existing = await prisma.emailDraft.findFirst({
    where: { leadId: lead.id, campaignId: campaign?.id ?? null, step: 0 },
  });
  if (existing && !opts.force) return { draft: existing, created: false };

  const scenario = scenarioForLead(lead);
  const tpl = await pickTemplate(lead.workspaceId, scenario, lead.category, campaign?.templateId);
  if (!tpl?.currentVersionId) throw new HttpError(422, `No ${scenario} template available`);
  const version = await prisma.emailTemplateVersion.findUniqueOrThrow({ where: { id: tpl.currentVersionId } });

  const built = await buildEmail({
    lead,
    subjectTpl: version.subject,
    bodyTpl: version.bodyMd,
    tone: ((campaign?.tone as Tone) ?? "friendly"),
    aiPersonalize: campaign?.aiPersonalize ?? true,
    ai: opts.ai,
  });

  const status = campaign?.approvalMode === "AUTO_SEND" ? "APPROVED" : "PENDING_REVIEW";
  const data = {
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    campaignId: campaign?.id ?? null,
    runId: opts.runId,
    templateVersionId: version.id,
    step: 0,
    subject: built.subject,
    bodyText: built.bodyText,
    bodyHtml: built.bodyHtml,
    variablesUsed: { ...built.variables, _warnings: built.warnings } as Prisma.InputJsonValue,
    aiGenerated: built.aiGenerated,
    status: status as "APPROVED" | "PENDING_REVIEW",
  };
  const draft = existing
    ? await prisma.emailDraft.update({ where: { id: existing.id }, data: { ...data, status: "PENDING_REVIEW" } })
    : await prisma.emailDraft.create({ data });
  return { draft, created: !existing };
}
