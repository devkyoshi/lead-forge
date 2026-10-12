import { effectiveDailyLimit, inSendWindow, startOfLocalDay, type FollowupStep, followupSequenceSchema } from "@leadforge/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { resolveSecret } from "../lib/secrets.js";
import { unsubscribeUrl } from "../lib/unsub.js";
import { createEmailProvider, EmailSendError, type EmailProvider } from "../providers/email.js";
import { generateDraft } from "./drafts.js";
import { isSuppressed } from "./suppression.js";
import { changeLeadStatus } from "./leads.js";

const MAX_ATTEMPTS = 5;
/** Minimum gap between two emails to the same recipient domain. */
const DOMAIN_GAP_MS = env.NODE_ENV === "test" ? 0 : 60_000;
const BATCH = 25;

export interface TickResult {
  sent: number;
  failed: number;
  deferred: { reason: string; count: number }[];
  followupsDrafted: number;
}

const HALTED = ["UNSUBSCRIBED", "BOUNCED"];
const FOLLOWUP_HALT = ["REPLIED", "INTERESTED", "PROPOSAL_SENT", "NEGOTIATING", "CONFIRMED", "LOST", "NOT_INTERESTED", "UNSUBSCRIBED", "BOUNCED"];

/** Creates due follow-up drafts. Stops automatically when the lead is no longer just CONTACTED. */
export async function scheduleFollowups(workspaceId: string, now = new Date()): Promise<number> {
  const campaigns = await prisma.campaign.findMany({ where: { workspaceId, status: "ACTIVE" } });
  let created = 0;
  for (const campaign of campaigns) {
    const seq = followupSequenceSchema.safeParse(campaign.followupSequence);
    if (!seq.success || !seq.data.length) continue;

    const firsts = await prisma.emailDraft.findMany({
      where: { workspaceId, campaignId: campaign.id, step: 0, status: "SENT", lead: { status: "CONTACTED", deletedAt: null } },
      include: { lead: true },
    });
    for (const first of firsts) {
      for (let i = 0; i < seq.data.length; i++) {
        const stepNo = i + 1;
        const step = seq.data[i] as FollowupStep;
        const prev = await prisma.emailDraft.findFirst({
          where: { leadId: first.leadId, campaignId: campaign.id, step: i },
          include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
        });
        const prevSent = prev?.status === "SENT" ? prev.messages[0]?.sentAt : null;
        if (!prevSent) break; // previous step not sent yet: wait
        const exists = await prisma.emailDraft.findFirst({ where: { leadId: first.leadId, campaignId: campaign.id, step: stepNo } });
        if (exists) continue;
        if (prevSent.getTime() + step.delayDays * 86_400_000 > now.getTime()) break;
        if (FOLLOWUP_HALT.includes(first.lead.status)) break;
        const email = await prisma.leadContact.findFirst({ where: { leadId: first.leadId, type: "EMAIL" }, orderBy: { confidence: "desc" } });
        if (!email || (await isSuppressed(workspaceId, email.value))) break;
        await generateDraft({ lead: first.lead, campaign, step: stepNo, scenario: step.scenario });
        created++;
        break; // one follow-up per lead per tick
      }
    }
  }
  return created;
}

async function blockReason(draft: { leadId: string; step: number; workspaceId: string }, to: string): Promise<string | null> {
  const lead = await prisma.lead.findUnique({ where: { id: draft.leadId }, select: { status: true, deletedAt: true } });
  if (!lead || lead.deletedAt) return "lead deleted";
  if (HALTED.includes(lead.status)) return `lead is ${lead.status.toLowerCase()}`;
  if (draft.step > 0 && FOLLOWUP_HALT.includes(lead.status)) return `follow-up halted (lead is ${lead.status.toLowerCase()})`;
  if (await isSuppressed(draft.workspaceId, to)) return "recipient is on the suppression list";
  return null;
}

/** Sends one approved draft. Re-checks suppression at the moment of sending. */
export async function sendDraft(draftId: string, provider: EmailProvider, opts: { now?: Date } = {}) {
  // Claim: only one worker can move APPROVED -> QUEUED, so a draft is never sent twice.
  const claimed = await prisma.emailDraft.updateMany({ where: { id: draftId, status: "APPROVED" }, data: { status: "QUEUED" } });
  if (!claimed.count) return { status: "skipped" as const };

  const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draftId }, include: { lead: true } });
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: draft.workspaceId } });
  const contact = await prisma.leadContact.findFirst({ where: { leadId: draft.leadId, type: "EMAIL" }, orderBy: { confidence: "desc" } });

  const fail = async (msg: string) => {
    await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "FAILED", lastError: msg } });
    return { status: "failed" as const, error: msg };
  };

  if (!contact) return fail("lead has no email address");
  const blocked = await blockReason(draft, contact.value);
  if (blocked) return fail(`blocked: ${blocked}`);
  if (!ws.senderAddress || !(ws.senderCompany || ws.senderName)) return fail("sender identity and physical address are required (Settings)");
  if (env.EMAIL_PROVIDER === "sendgrid" && !ws.fromEmail) return fail("From email is not configured (Settings)");

  const unsub = unsubscribeUrl(draft.workspaceId, draft.leadId);
  try {
    const message = await prisma.emailMessage.create({
      data: { workspaceId: draft.workspaceId, leadId: draft.leadId, draftId, toEmail: contact.value, provider: provider.name, status: "sending", threadKey: draft.id },
    });
    try {
      const { providerMessageId } = await provider.send({
        to: contact.value,
        from: { email: ws.fromEmail ?? "noreply@localhost", name: ws.senderName ?? ws.senderCompany ?? undefined },
        replyTo: ws.replyTo ?? undefined,
        subject: draft.subject,
        html: draft.bodyHtml,
        text: draft.bodyText,
        unsubscribeUrl: unsub,
        customArgs: { message_id: message.id, workspace_id: draft.workspaceId },
      });
      const sentAt = opts.now ?? new Date();
      await prisma.$transaction([
        prisma.emailMessage.update({ where: { id: message.id }, data: { status: "sent", providerMessageId, sentAt } }),
        prisma.emailDraft.update({ where: { id: draftId }, data: { status: "SENT", lastError: null } }),
      ]);
      if (draft.step === 0 && ["NEW", "QUALIFIED"].includes(draft.lead.status)) {
        await changeLeadStatus(draft.workspaceId, draft.leadId, { status: "CONTACTED" }, "system");
      }
      return { status: "sent" as const, messageId: message.id };
    } catch (err) {
      await prisma.emailMessage.delete({ where: { id: message.id } }).catch(() => {});
      throw err;
    }
  } catch (err) {
    const fatal = err instanceof EmailSendError && err.fatal;
    const attempts = draft.attempts + 1;
    const msg = (err as Error).message;
    if (fatal || attempts >= MAX_ATTEMPTS) return fail(fatal ? msg : `gave up after ${attempts} attempts: ${msg}`);
    // Exponential backoff: 2, 4, 8, 16 minutes.
    await prisma.emailDraft.update({
      where: { id: draftId },
      data: { status: "APPROVED", attempts, lastError: msg, nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000) },
    });
    return { status: "retry" as const, error: msg };
  }
}

/**
 * One dispatcher pass for a workspace: creates due follow-ups, then sends approved drafts while
 * respecting the send window, warm-up/daily and hourly caps, the per-campaign daily limit and the
 * per-recipient-domain gap. Anything over a cap simply stays APPROVED for the next tick.
 */
export async function dispatchWorkspace(workspaceId: string, provider?: EmailProvider, now = new Date()): Promise<TickResult> {
  const result: TickResult = { sent: 0, failed: 0, deferred: [], followupsDrafted: 0 };
  const defer = (reason: string, count = 1) => {
    const e = result.deferred.find((d) => d.reason === reason);
    if (e) e.count += count;
    else result.deferred.push({ reason, count });
  };

  result.followupsDrafted = await scheduleFollowups(workspaceId, now);

  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const due = await prisma.emailDraft.findMany({
    where: {
      workspaceId,
      status: "APPROVED",
      AND: [
        { OR: [{ campaignId: null }, { campaign: { status: "ACTIVE" } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
      ],
    },
    orderBy: [{ step: "desc" }, { createdAt: "asc" }], // follow-ups first: they are time-sensitive
    take: BATCH * 4,
    include: { campaign: true },
  });
  if (!due.length) return result;

  if (!inSendWindow(ws.timezone, ws.sendWindowStart, ws.sendWindowEnd, now)) {
    defer("outside send window", due.length);
    return result;
  }

  const dayStart = startOfLocalDay(ws.timezone, now);
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const sentToday = await prisma.emailMessage.count({ where: { workspaceId, direction: "OUT", sentAt: { gte: dayStart } } });
  const sentLastHour = await prisma.emailMessage.count({ where: { workspaceId, direction: "OUT", sentAt: { gte: hourAgo } } });
  const dailyCap = effectiveDailyLimit({ dailyLimit: ws.dailyLimit, warmupEnabled: ws.warmupEnabled, warmupStartedAt: ws.warmupStartedAt, now });
  let dayRemaining = dailyCap - sentToday;
  let hourRemaining = ws.hourlyLimit - sentLastHour;

  const campaignToday = new Map<string, number>();
  const recentDomains = new Map<string, number>(); // domain -> last send ms
  const recent = await prisma.emailMessage.findMany({ where: { workspaceId, direction: "OUT", sentAt: { gte: new Date(now.getTime() - DOMAIN_GAP_MS) } }, select: { toEmail: true, sentAt: true } });
  for (const m of recent) recentDomains.set(m.toEmail.split("@")[1] ?? "", m.sentAt?.getTime() ?? 0);

  const prov = provider ?? createEmailProvider(await resolveSecret(workspaceId, "SENDGRID"));
  let attempted = 0;

  for (const d of due) {
    if (attempted >= BATCH) break;
    if (dayRemaining <= 0) {
      defer("daily limit reached");
      continue;
    }
    if (hourRemaining <= 0) {
      defer("hourly limit reached");
      continue;
    }
    if (d.campaignId && d.campaign) {
      if (!campaignToday.has(d.campaignId)) {
        const n = await prisma.emailMessage.count({ where: { workspaceId, direction: "OUT", sentAt: { gte: dayStart }, draft: { campaignId: d.campaignId } } });
        campaignToday.set(d.campaignId, n);
      }
      if ((campaignToday.get(d.campaignId) ?? 0) >= d.campaign.dailySendLimit) {
        defer("campaign daily limit reached");
        continue;
      }
    }
    const contact = await prisma.leadContact.findFirst({ where: { leadId: d.leadId, type: "EMAIL" }, orderBy: { confidence: "desc" } });
    const domain = contact?.value.split("@")[1] ?? "";
    if (domain && now.getTime() - (recentDomains.get(domain) ?? 0) < DOMAIN_GAP_MS) {
      defer("per-domain throttle");
      continue;
    }

    attempted++;
    const r = await sendDraft(d.id, prov, { now });
    if (r.status === "sent") {
      result.sent++;
      dayRemaining--;
      hourRemaining--;
      if (d.campaignId) campaignToday.set(d.campaignId, (campaignToday.get(d.campaignId) ?? 0) + 1);
      if (domain) recentDomains.set(domain, now.getTime());
    } else if (r.status === "failed") result.failed++;
  }
  return result;
}

export async function dispatchAll(provider?: EmailProvider): Promise<Record<string, TickResult>> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const out: Record<string, TickResult> = {};
  for (const w of workspaces) {
    try {
      out[w.id] = await dispatchWorkspace(w.id, provider);
    } catch (e) {
      console.error(`dispatch failed for workspace ${w.id}:`, (e as Error).message);
    }
  }
  return out;
}
