import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { prisma } from "../db.js";
import { buildApp } from "../app.js";
import { createUnsubToken } from "../lib/unsub.js";
import type { EmailProvider, OutgoingEmail } from "../providers/email.js";
import { executeRun } from "../services/orchestrator.js";
import { ensureDefaultTemplates } from "../services/drafts.js";
import { applyEmailEvent } from "../services/events.js";
import { HttpError, changeLeadStatus } from "../services/leads.js";
import { dispatchWorkspace, scheduleFollowups } from "../services/sender.js";

/** Captures what would have been sent instead of emailing anyone. */
class CapturingProvider implements EmailProvider {
  readonly name = "capture";
  sent: OutgoingEmail[] = [];
  async send(msg: OutgoingEmail) {
    this.sent.push(msg);
    return { providerMessageId: `test-${this.sent.length}` };
  }
}

let app: FastifyInstance;
let workspaceId: string;
let campaignId: string;
const provider = new CapturingProvider();

async function newRun() {
  return prisma.campaignRun.create({ data: { workspaceId, campaignId, trigger: "MANUAL", status: "QUEUED", counts: {} } });
}
const count = (where: object) => prisma.lead.count({ where: { workspaceId, ...where } });

beforeAll(async () => {
  // The mock places provider points leads at this server's /mock-sites routes, so audits run offline.
  app = await buildApp();
  await app.listen({ port: 4010, host: "127.0.0.1" });

  const ws = await prisma.workspace.create({
    data: {
      name: "Integration workspace",
      senderName: "Alex",
      senderCompany: "Test Studio",
      senderAddress: "1 Test Street, Testville",
      fromEmail: "hello@example.com",
      portfolioLink: "https://example.com/work",
      timezone: "UTC",
      sendWindowStart: 0,
      sendWindowEnd: 24,
      dailyLimit: 100,
      hourlyLimit: 100,
    },
  });
  workspaceId = ws.id;
  await prisma.user.create({ data: { workspaceId, email: "it@example.com", name: "Tester", passwordHash: await argon2.hash("password123"), role: "OWNER" } });
  await prisma.scoringConfig.create({
    data: { workspaceId, weights: { noWebsite: 40, socialOnly: 32, broken: 30, poorWebsite: 22, rating: 15, reviews: 15, categoryFit: 10 }, qualifyThreshold: 30, autoQueueThreshold: 40 },
  });
  await ensureDefaultTemplates(workspaceId);
  const campaign = await prisma.campaign.create({
    data: {
      workspaceId,
      name: "Integration campaign",
      status: "ACTIVE",
      area: { type: "city", label: "Testville", query: "Testville" },
      categories: ["hotel", "salon"],
      approvalMode: "REVIEW_FIRST",
      followupSequence: [{ delayDays: 3, scenario: "FOLLOWUP_1" }],
      aiPersonalize: true,
    },
  });
  campaignId = campaign.id;
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe("full campaign run with mocked providers", () => {
  it("discovers, dedupes, audits, enriches, scores and drafts", async () => {
    const run = await newRun();
    await executeRun(run.id);

    const done = await prisma.campaignRun.findUniqueOrThrow({ where: { id: run.id }, include: { stages: true } });
    expect(done.status).toBe("COMPLETED");
    expect(done.stages.map((s) => s.stage).sort()).toEqual(["audit", "discover", "draft", "enrich", "score"]);
    expect(done.stages.every((s) => s.status === "COMPLETED")).toBe(true);

    const counts = done.counts as Record<string, number>;
    expect(counts.discovered).toBe(20); // 2 categories x (9 businesses + 1 duplicate listing)
    expect(counts.duplicates).toBe(2); // each duplicate listing is caught by phone/name+address
    expect(counts.new).toBe(18);
    expect(await count({})).toBe(18);

    // Every website situation was audited, with an explainable result.
    for (const websiteStatus of ["NO_WEBSITE", "SOCIAL_ONLY", "BROKEN", "POOR", "OK"] as const) {
      expect(await count({ websiteStatus }), websiteStatus).toBeGreaterThan(0);
    }
    expect(await prisma.leadAudit.count({ where: { workspaceId } })).toBe(18);

    // Leads without a public email are flagged for manual outreach instead of failing.
    expect(await count({ needsManualOutreach: true })).toBeGreaterThan(0);
    expect(await prisma.leadContact.count({ where: { workspaceId, type: "EMAIL" } })).toBeGreaterThan(0);

    // Scoring is stored with a breakdown and qualifies leads.
    const qualified = await prisma.lead.findMany({ where: { workspaceId, status: "QUALIFIED" } });
    expect(qualified.length).toBeGreaterThan(0);
    expect(qualified.every((l) => l.scoreBreakdown !== null && l.score >= 30)).toBe(true);
  });

  it("drafts reference each lead's real website issues and carry the compliance footer", async () => {
    const drafts = await prisma.emailDraft.findMany({ where: { workspaceId }, include: { lead: true } });
    expect(drafts.length).toBeGreaterThan(0);

    for (const d of drafts) {
      expect(d.status).toBe("PENDING_REVIEW"); // REVIEW_FIRST: nothing is auto-approved
      expect(d.bodyText).toContain("/u/"); // working unsubscribe link
      expect(d.bodyText).toContain("1 Test Street, Testville"); // sender identity and address
      expect(d.bodyText).toContain(d.lead.name);
      expect(d.bodyText).not.toMatch(/\{\{/); // no unrendered variables
    }
    const poor = drafts.find((d) => d.lead.websiteStatus === "POOR");
    expect(poor?.bodyText).toMatch(/mobile-friendly|outdated|contact form/i);
    const noSite = drafts.find((d) => d.lead.websiteStatus === "NO_WEBSITE");
    if (noSite) expect(noSite.bodyText).toMatch(/could not find a website/i);
  });

  it("is idempotent: re-running creates no duplicate leads or drafts", async () => {
    const leadsBefore = await count({});
    const draftsBefore = await prisma.emailDraft.count({ where: { workspaceId } });

    const run = await newRun();
    await executeRun(run.id);

    const counts = (await prisma.campaignRun.findUniqueOrThrow({ where: { id: run.id } })).counts as Record<string, number>;
    expect(counts.new).toBe(0);
    expect(counts.duplicates).toBe(20);
    expect(await count({})).toBe(leadsBefore);
    expect(await prisma.emailDraft.count({ where: { workspaceId } })).toBe(draftsBefore);
  });

  it("refuses to start a second run while one is active", async () => {
    const { startRun } = await import("../services/runs.js");
    await prisma.campaignRun.create({ data: { workspaceId, campaignId, trigger: "MANUAL", status: "RUNNING", counts: {} } });
    await expect(startRun(workspaceId, campaignId, "CRON")).rejects.toMatchObject({ statusCode: 409 });
    await prisma.campaignRun.updateMany({ where: { workspaceId, status: "RUNNING" }, data: { status: "CANCELLED" } });
  });
});

describe("approval, sending and compliance", () => {
  it("sends approved drafts, moves leads to CONTACTED and ticks the checklist", async () => {
    const drafts = await prisma.emailDraft.findMany({ where: { workspaceId } });
    await prisma.emailDraft.updateMany({ where: { workspaceId }, data: { status: "APPROVED" } });

    const result = await dispatchWorkspace(workspaceId, provider);
    expect(result.sent).toBe(drafts.length);
    expect(provider.sent).toHaveLength(drafts.length);
    expect(provider.sent.every((m) => m.unsubscribeUrl?.includes("/u/"))).toBe(true);
    expect(provider.sent.every((m) => m.html.includes("1 Test Street"))).toBe(true);

    const contacted = await prisma.lead.findMany({ where: { workspaceId, status: "CONTACTED" }, include: { checklist: true } });
    expect(contacted).toHaveLength(drafts.length);
    expect(contacted.every((l) => l.checklist.find((c) => c.key === "first_email_sent")?.done)).toBe(true);

    // Nothing is sent twice.
    expect((await dispatchWorkspace(workspaceId, provider)).sent).toBe(0);
  });

  it("defers sends over the daily limit instead of dropping them", async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, status: "CONTACTED" } });
    await prisma.workspace.update({ where: { id: workspaceId }, data: { dailyLimit: provider.sent.length } });
    const extra = await prisma.emailDraft.create({
      data: { workspaceId, leadId: lead.id, campaignId, step: 9, subject: "extra", bodyText: "extra", bodyHtml: "<p>extra</p>", status: "APPROVED" },
    });

    const before = provider.sent.length;
    const result = await dispatchWorkspace(workspaceId, provider);
    expect(result.sent).toBe(0);
    expect(result.deferred.map((d) => d.reason)).toContain("daily limit reached");
    expect(provider.sent).toHaveLength(before);
    expect((await prisma.emailDraft.findUniqueOrThrow({ where: { id: extra.id } })).status).toBe("APPROVED"); // still waiting

    await prisma.emailDraft.delete({ where: { id: extra.id } });
    await prisma.workspace.update({ where: { id: workspaceId }, data: { dailyLimit: 100 } });
  });

  it("a bounce suppresses the address, marks the lead BOUNCED and blocks any later draft", async () => {
    const msg = await prisma.emailMessage.findFirstOrThrow({ where: { workspaceId, direction: "OUT" }, include: { lead: true }, orderBy: { createdAt: "asc" } });
    await applyEmailEvent({ messageId: msg.id, type: "BOUNCE", providerEventId: "evt-bounce-1" });
    // The same webhook delivered twice is ignored.
    expect((await applyEmailEvent({ messageId: msg.id, type: "BOUNCE", providerEventId: "evt-bounce-1" })).applied).toBe(false);

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: msg.leadId } })).status).toBe("BOUNCED");
    expect(await prisma.suppression.findFirst({ where: { workspaceId, value: msg.toEmail.toLowerCase(), reason: "BOUNCE" } })).not.toBeNull();

    const sentBefore = provider.sent.length;
    const draft = await prisma.emailDraft.create({
      data: { workspaceId, leadId: msg.leadId, campaignId, step: 7, subject: "again", bodyText: "again", bodyHtml: "<p>again</p>", status: "APPROVED" },
    });
    const result = await dispatchWorkspace(workspaceId, provider);
    expect(result.sent).toBe(0);
    expect(provider.sent).toHaveLength(sentBefore); // never emailed again
    const after = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatch(/blocked/);

    // A bounced lead cannot be reopened.
    await expect(changeLeadStatus(workspaceId, msg.leadId, { status: "NEW" }, "test")).rejects.toBeInstanceOf(HttpError);
  });

  it("the unsubscribe link suppresses every address for the lead and cancels its drafts", async () => {
    const msg = await prisma.emailMessage.findFirstOrThrow({ where: { workspaceId, direction: "OUT", lead: { status: "CONTACTED" } } });
    const token = createUnsubToken(workspaceId, msg.leadId);

    const page = await app.inject({ method: "GET", url: `/u/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Unsubscribe");
    const post = await app.inject({ method: "POST", url: `/u/${token}` });
    expect(post.statusCode).toBe(200);

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: msg.leadId } })).status).toBe("UNSUBSCRIBED");
    expect(await prisma.suppression.findFirst({ where: { workspaceId, value: msg.toEmail.toLowerCase(), reason: "UNSUBSCRIBE" } })).not.toBeNull();
    expect((await app.inject({ method: "GET", url: "/u/not-a-real-token.abc" })).statusCode).toBe(400);
  });
});

describe("follow-ups and status rules", () => {
  it("drafts follow-ups only for leads that are still just CONTACTED", async () => {
    // One more lead replies: its follow-ups must stop.
    const replier = await prisma.emailMessage.findFirstOrThrow({ where: { workspaceId, direction: "OUT", lead: { status: "CONTACTED" } } });
    await applyEmailEvent({ messageId: replier.id, type: "REPLY", providerEventId: "evt-reply-1" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: replier.leadId } })).status).toBe("REPLIED");

    const stillContacted = await prisma.lead.count({ where: { workspaceId, status: "CONTACTED" } });
    // Too early: the first follow-up is due 3 days after the first email.
    expect(await scheduleFollowups(workspaceId, new Date(Date.now() + 24 * 3600 * 1000))).toBe(0);

    const later = new Date(Date.now() + 4 * 24 * 3600 * 1000);
    const created = await scheduleFollowups(workspaceId, later);
    expect(created).toBe(stillContacted);

    const followups = await prisma.emailDraft.findMany({ where: { workspaceId, step: 1 }, include: { lead: true } });
    expect(followups).toHaveLength(stillContacted);
    expect(followups.every((f) => f.lead.status === "CONTACTED")).toBe(true);
    // Not drafted for the replied, bounced or unsubscribed leads.
    const excluded = await prisma.lead.findMany({ where: { workspaceId, status: { in: ["REPLIED", "BOUNCED", "UNSUBSCRIBED"] } }, select: { id: true } });
    expect(followups.some((f) => excluded.some((e) => e.id === f.leadId))).toBe(false);

    // Running it again does not duplicate follow-ups.
    expect(await scheduleFollowups(workspaceId, later)).toBe(0);
  });

  it("enforces required details when closing or confirming a lead", async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, status: "QUALIFIED" } });
    await expect(changeLeadStatus(workspaceId, lead.id, { status: "LOST" }, "test")).rejects.toThrow(/reason/i);
    await expect(changeLeadStatus(workspaceId, lead.id, { status: "CONFIRMED" }, "test")).rejects.toThrow(/project/i);

    const confirmed = await changeLeadStatus(workspaceId, lead.id, { status: "CONFIRMED", project: { name: "New website", value: 2500 } }, "test");
    expect(confirmed.status).toBe("CONFIRMED");
    const items = await prisma.leadChecklistItem.findMany({ where: { leadId: lead.id } });
    expect(items.find((c) => c.key === "deal_confirmed")?.done).toBe(true); // checklist ticked by the system
    const history = await prisma.leadStatusHistory.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(history.at(-1)).toMatchObject({ fromStatus: "QUALIFIED", toStatus: "CONFIRMED" });
  });
});
