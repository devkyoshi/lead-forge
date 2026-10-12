import type { Campaign, Lead, Prisma } from "@prisma/client";
import {
  DEFAULT_WEIGHTS,
  analyzeHtml,
  areaSchema,
  campaignFiltersSchema,
  isSocialUrl,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  scoreLead,
  scoringWeightsSchema,
  extractEmails,
  DEFAULT_CHECKLIST,
  type AuditIssue,
} from "@leadforge/shared";
import { prisma } from "../db.js";
import { politeFetch } from "../lib/fetcher.js";
import type { PlacesProvider, PlaceResult } from "../providers/places.js";
import { changeLeadStatus } from "./leads.js";
import { generateDraft } from "./drafts.js";
import { isSuppressed } from "./suppression.js";
import type { AiProvider } from "../providers/ai.js";
import { createEnrichmentProvider, type EnrichmentProvider } from "../providers/enrichment.js";

export interface StageCtx {
  runId: string;
  workspaceId: string;
  campaign: Campaign;
  log: (msg: string) => void;
  /** Throws if the run was cancelled; called between units of work. */
  checkCancelled: () => Promise<void>;
}

export interface StageResult {
  counts: Record<string, number>;
}

/** Run an async mapper over items with bounded concurrency. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++]!;
        await fn(item);
      }
    }),
  );
}

/** Find an existing lead by source place id, normalized phone, or normalized name + address. */
export async function findDuplicate(workspaceId: string, p: PlaceResult & { normalizedPhone: string | null; normalizedName: string; normalizedAddress: string }) {
  return prisma.lead.findFirst({
    where: {
      workspaceId,
      OR: [
        { source: "places", sourcePlaceId: p.sourcePlaceId },
        ...(p.normalizedPhone ? [{ normalizedPhone: p.normalizedPhone }] : []),
        { normalizedName: p.normalizedName, normalizedAddress: p.normalizedAddress },
      ],
    },
    select: { id: true },
  });
}

export async function discoverStage(ctx: StageCtx, places: PlacesProvider): Promise<StageResult> {
  const area = areaSchema.parse(ctx.campaign.area);
  const filters = campaignFiltersSchema.parse(ctx.campaign.filters ?? {});
  const counts = { discovered: 0, new: 0, duplicates: 0, filtered: 0 };
  const checklist = DEFAULT_CHECKLIST;

  for (const category of ctx.campaign.categories) {
    await ctx.checkCancelled();
    const results = await places.search({ area, category });
    ctx.log(`${category}: provider returned ${results.length} places`);
    counts.discovered += results.length;

    for (const p of results) {
      if (
        (filters.minRating !== undefined && (p.rating ?? 0) < filters.minRating) ||
        (filters.minReviews !== undefined && (p.reviewCount ?? 0) < filters.minReviews)
      ) {
        counts.filtered++;
        continue;
      }
      const key = {
        normalizedName: normalizeName(p.name),
        normalizedAddress: p.address ? normalizeAddress(p.address) : "",
        normalizedPhone: p.phone ? normalizePhone(p.phone) : null,
      };
      const dup = await findDuplicate(ctx.workspaceId, { ...p, ...key });
      if (dup) {
        counts.duplicates++;
        continue;
      }
      try {
        await prisma.$transaction(async (tx) => {
          const lead = await tx.lead.create({
            data: {
              workspaceId: ctx.workspaceId,
              campaignId: ctx.campaign.id,
              name: p.name,
              address: p.address,
              phone: p.phone,
              category: p.category ?? category,
              area: area.label,
              rating: p.rating,
              reviewCount: p.reviewCount,
              lat: p.lat,
              lng: p.lng,
              websiteUrl: p.websiteUrl,
              source: "places",
              sourcePlaceId: p.sourcePlaceId,
              tags: [],
              ...key,
            },
          });
          await tx.leadChecklistItem.createMany({
            data: checklist.map((c, i) => ({ workspaceId: ctx.workspaceId, leadId: lead.id, key: c.key, label: c.label, position: i })),
          });
          await tx.leadStatusHistory.create({
            data: { workspaceId: ctx.workspaceId, leadId: lead.id, toStatus: "NEW", actor: "system", reason: `Discovered by campaign run ${ctx.runId}` },
          });
          if (p.email) {
            await tx.leadContact.create({
              data: { workspaceId: ctx.workspaceId, leadId: lead.id, type: "EMAIL", value: p.email, normalizedValue: normalizeEmail(p.email), source: "places", confidence: 0.8 },
            });
          }
        });
        counts.new++;
      } catch (e) {
        // Unique-constraint race (parallel run / re-trigger): treat as duplicate, never as a second lead.
        if ((e as { code?: string }).code === "P2002") counts.duplicates++;
        else throw e;
      }
    }
  }
  ctx.log(`discovered ${counts.discovered}, new ${counts.new}, duplicates ${counts.duplicates}, filtered out ${counts.filtered}`);
  return { counts };
}

async function auditLead(lead: Lead): Promise<{
  status: "NO_WEBSITE" | "SOCIAL_ONLY" | "BROKEN" | "POOR" | "OK";
  score: number | null;
  issues: AuditIssue[];
  checks: Record<string, unknown>;
  emails: { value: string; confidence: number }[];
}> {
  if (!lead.websiteUrl) {
    return { status: "NO_WEBSITE", score: 0, issues: [{ code: "NO_WEBSITE", message: "No website listed" }], checks: {}, emails: [] };
  }
  if (isSocialUrl(lead.websiteUrl)) {
    return { status: "SOCIAL_ONLY", score: 10, issues: [{ code: "SOCIAL_ONLY", message: "Only a social media page, no real website" }], checks: { url: lead.websiteUrl }, emails: [] };
  }
  const res = await politeFetch(lead.websiteUrl);
  if (!res.ok) {
    if (res.reason === "BLOCKED_ROBOTS" || res.reason === "BLOCKED_PRIVATE") {
      // We may not audit it; do not claim it is broken.
      return { status: "OK", score: null, issues: [], checks: { skipped: res.reason, detail: res.detail }, emails: [] };
    }
    const messages: Record<string, string> = {
      TIMEOUT: "Website timed out",
      SSL: "Website has an invalid SSL certificate",
      NETWORK: "Website could not be reached",
      HTTP_ERROR: "Website returns an error",
      INVALID_URL: "Website address is invalid",
    };
    return {
      status: "BROKEN",
      score: 5,
      issues: [{ code: res.reason, message: `${messages[res.reason] ?? "Website is broken"} (${res.detail})` }],
      checks: { reason: res.reason, detail: res.detail },
      emails: [],
    };
  }
  const a = analyzeHtml({ url: lead.websiteUrl, finalUrl: res.finalUrl, html: res.html, responseMs: res.ms, lastModified: res.lastModified });
  return { status: a.score < 60 ? "POOR" : "OK", score: a.score, issues: a.issues, checks: a.checks, emails: a.emails };
}

async function saveEmails(lead: Lead, emails: { value: string; confidence: number }[], source: string) {
  for (const e of emails.slice(0, 3)) {
    await prisma.leadContact.upsert({
      where: { leadId_type_normalizedValue: { leadId: lead.id, type: "EMAIL", normalizedValue: normalizeEmail(e.value) } },
      create: { workspaceId: lead.workspaceId, leadId: lead.id, type: "EMAIL", value: e.value, normalizedValue: normalizeEmail(e.value), source, confidence: e.confidence },
      update: {},
    });
  }
}

export async function tickChecklist(workspaceId: string, leadId: string, keys: string[]) {
  await prisma.leadChecklistItem.updateMany({
    where: { workspaceId, leadId, key: { in: keys }, done: false },
    data: { done: true, doneAt: new Date(), doneBy: "system" },
  });
}

/** Audits campaign leads that have no audit yet; resumable and safe to re-run. */
export async function auditStage(ctx: StageCtx): Promise<StageResult> {
  const leads = await prisma.lead.findMany({
    where: { workspaceId: ctx.workspaceId, campaignId: ctx.campaign.id, deletedAt: null, audits: { none: {} } },
  });
  let audited = 0;
  let failed = 0;
  await mapLimit(leads, 4, async (lead) => {
    await ctx.checkCancelled();
    try {
      const r = await auditLead(lead);
      await prisma.$transaction(async (tx) => {
        await tx.leadAudit.create({
          data: {
            workspaceId: ctx.workspaceId,
            leadId: lead.id,
            version: 1,
            websiteStatus: r.status,
            websiteScore: r.score,
            issues: r.issues as unknown as Prisma.InputJsonValue,
            checks: { ...r.checks, emails: r.emails } as Prisma.InputJsonValue,
          },
        });
        await tx.lead.update({ where: { id: lead.id }, data: { websiteStatus: r.status, websiteScore: r.score } });
      });
      await saveEmails(lead, r.emails, "website");
      await tickChecklist(ctx.workspaceId, lead.id, ["website_audited"]);
      audited++;
    } catch (e) {
      failed++;
      ctx.log(`audit failed for ${lead.name}: ${(e as Error).message}`);
    }
  });
  ctx.log(`audited ${audited} leads (${failed} failed)`);
  return { counts: { audited, failed } };
}

/** Finds public emails on the lead's own site (contact page); flags the rest for manual outreach. */
export async function enrichStage(ctx: StageCtx, enrichment: EnrichmentProvider = createEnrichmentProvider()): Promise<StageResult> {
  const leads = await prisma.lead.findMany({
    where: { workspaceId: ctx.workspaceId, campaignId: ctx.campaign.id, deletedAt: null, enrichedAt: null, audits: { some: {} } },
    include: { contacts: { where: { type: "EMAIL" } } },
  });
  let withEmail = 0;
  let manual = 0;
  await mapLimit(leads, 4, async (lead) => {
    await ctx.checkCancelled();
    let hasEmail = lead.contacts.length > 0;
    if (!hasEmail) {
      const found = await enrichment.findEmails({ websiteUrl: lead.websiteUrl, websiteStatus: lead.websiteStatus });
      if (found.length) {
        await saveEmails(lead, found, found[0]!.source);
        hasEmail = true;
      }
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { enrichedAt: new Date(), needsManualOutreach: !hasEmail } });
    if (hasEmail) {
      await tickChecklist(ctx.workspaceId, lead.id, ["contact_verified"]);
      withEmail++;
    } else manual++;
  });
  ctx.log(`${withEmail} leads with a public email, ${manual} need manual outreach`);
  return { counts: { withEmail, manual } };
}

export async function loadScoring(workspaceId: string) {
  const cfg = await prisma.scoringConfig.findFirst({ where: { workspaceId, active: true }, orderBy: { createdAt: "desc" } });
  return {
    weights: cfg ? scoringWeightsSchema.parse(cfg.weights) : DEFAULT_WEIGHTS,
    qualifyThreshold: cfg?.qualifyThreshold ?? 50,
    autoQueueThreshold: cfg?.autoQueueThreshold ?? 70,
  };
}

export async function scoreStage(ctx: StageCtx): Promise<StageResult> {
  const { weights, qualifyThreshold } = await loadScoring(ctx.workspaceId);
  const leads = await prisma.lead.findMany({
    where: { workspaceId: ctx.workspaceId, campaignId: ctx.campaign.id, deletedAt: null, status: { in: ["NEW", "QUALIFIED"] }, audits: { some: {} } },
  });
  let qualified = 0;
  for (const lead of leads) {
    await ctx.checkCancelled();
    const r = scoreLead(
      {
        websiteStatus: lead.websiteStatus,
        websiteScore: lead.websiteScore,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        category: lead.category,
        targetCategories: ctx.campaign.categories,
      },
      weights,
    );
    await prisma.lead.update({ where: { id: lead.id }, data: { score: r.score, scoreBreakdown: r.breakdown as unknown as Prisma.InputJsonValue } });
    if (r.score >= qualifyThreshold) {
      qualified++;
      if (lead.status === "NEW") await changeLeadStatus(ctx.workspaceId, lead.id, { status: "QUALIFIED", reason: `Score ${r.score} >= ${qualifyThreshold}` }, "system");
    }
  }
  ctx.log(`scored ${leads.length} leads, ${qualified} qualified (threshold ${qualifyThreshold})`);
  return { counts: { scored: leads.length, qualified } };
}

/** Drafts a personalised email for each qualified, contactable lead above the auto-queue threshold. */
export async function draftStage(ctx: StageCtx, ai?: AiProvider): Promise<StageResult> {
  const { autoQueueThreshold } = await loadScoring(ctx.workspaceId);
  const leads = await prisma.lead.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      campaignId: ctx.campaign.id,
      deletedAt: null,
      status: "QUALIFIED",
      score: { gte: autoQueueThreshold },
      drafts: { none: { campaignId: ctx.campaign.id, step: 0 } },
    },
    include: { contacts: { where: { type: "EMAIL" }, orderBy: { confidence: "desc" }, take: 1 } },
  });
  let drafted = 0;
  let suppressed = 0;
  let skipped = 0;
  for (const lead of leads) {
    await ctx.checkCancelled();
    const email = lead.contacts[0]?.value;
    if (!email) {
      skipped++;
      continue;
    }
    if (await isSuppressed(ctx.workspaceId, email)) {
      suppressed++;
      continue;
    }
    try {
      const { created } = await generateDraft({ lead, campaign: ctx.campaign, runId: ctx.runId, ai });
      if (created) drafted++;
    } catch (e) {
      ctx.log(`draft failed for ${lead.name}: ${(e as Error).message}`);
    }
  }
  ctx.log(`${drafted} drafts created (${skipped} leads without email, ${suppressed} suppressed; threshold ${autoQueueThreshold})`);
  return { counts: { drafted } };
}
