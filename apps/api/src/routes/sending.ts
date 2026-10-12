import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { effectiveDailyLimit, inSendWindow, normalizeEmail, optInRegionWarnings, startOfLocalDay } from "@leadforge/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { resolveSecret } from "../lib/secrets.js";
import { unsubscribeUrl } from "../lib/unsub.js";
import { createEmailProvider } from "../providers/email.js";
import { buildEmail, pickTemplate, scenarioForLead } from "../services/drafts.js";
import { applyEmailEvent } from "../services/events.js";
import { HttpError } from "../services/leads.js";
import { dispatchWorkspace, getSendStatus } from "../services/sender.js";
import { cancelPendingDrafts } from "../services/compliance.js";

const idParam = z.object({ id: z.string().min(1) });

export const sendingRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  /** Runs one dispatcher pass now (still honours window, caps and throttles). */
  r.post("/send/tick", { ...auth, schema: { tags: ["sending"] } }, async (req) => dispatchWorkspace(req.auth.workspaceId));

  r.get("/send/status", { ...auth, schema: { tags: ["sending"] } }, async (req) => getSendStatus(req.auth.workspaceId));

  r.post(
    "/templates/:id/test-send",
    { ...auth, schema: { params: idParam, body: z.object({ leadId: z.string().optional() }), tags: ["templates"] } },
    async (req) => {
      const wsId = req.auth.workspaceId;
      const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
      if (!ws.senderAddress) throw new HttpError(422, "Set your physical address in Settings before sending (required in every email)");
      if (env.EMAIL_PROVIDER === "sendgrid" && !ws.fromEmail) throw new HttpError(422, "Set a From email in Settings first");
      const tpl = await prisma.emailTemplate.findFirst({ where: { id: req.params.id, workspaceId: wsId } });
      if (!tpl?.currentVersionId) throw new HttpError(404, "Template not found");
      const v = await prisma.emailTemplateVersion.findUniqueOrThrow({ where: { id: tpl.currentVersionId } });
      const lead = await prisma.lead.findFirst({
        where: { workspaceId: wsId, deletedAt: null, ...(req.body.leadId ? { id: req.body.leadId } : {}) },
        orderBy: { score: "desc" },
      });
      if (!lead) throw new HttpError(404, "No lead to preview with");
      const built = await buildEmail({ lead, subjectTpl: v.subject, bodyTpl: v.bodyMd, tone: "friendly", aiPersonalize: false });
      const provider = createEmailProvider(await resolveSecret(wsId, "SENDGRID"));
      await provider.send({
        to: user.email,
        from: { email: ws.fromEmail ?? "noreply@localhost", name: ws.senderName ?? ws.senderCompany ?? undefined },
        replyTo: ws.replyTo ?? undefined,
        subject: `[TEST] ${built.subject}`,
        html: built.bodyHtml,
        text: built.bodyText,
        unsubscribeUrl: unsubscribeUrl(wsId, lead.id),
      });
      return { sentTo: user.email, usedLead: lead.name };
    },
  );

  /** Pre-flight checks for a campaign: blocking errors, plus region opt-in warnings. */
  r.post("/campaigns/:id/validate", { ...auth, schema: { params: idParam, tags: ["campaigns"] } }, async (req) => {
    const wsId = req.auth.workspaceId;
    const c = await prisma.campaign.findFirst({ where: { id: req.params.id, workspaceId: wsId } });
    if (!c) throw new HttpError(404, "Campaign not found");
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!ws.senderAddress) errors.push("Physical sender address is missing (Settings > Sender). It is required in every email.");
    if (!ws.senderName && !ws.senderCompany) errors.push("Sender name or company is missing (Settings > Sender).");
    if (env.EMAIL_PROVIDER === "sendgrid" && !ws.fromEmail) errors.push("From email is missing (Settings > Sender).");
    if (!ws.replyTo) warnings.push("No reply-to address is set, so replies go to the From address.");
    const area = c.area as { label?: string; query?: string };
    const regionWarnings = optInRegionWarnings(`${area.label ?? ""} ${area.query ?? ""}`);
    for (const w of regionWarnings) warnings.push(`${w} Review your jurisdiction notes in Settings; confirm you have a lawful basis before sending.`);
    if (c.approvalMode === "AUTO_SEND") warnings.push("Auto-send is on: emails go out without a manual review.");
    const scenarios = ["NO_WEBSITE", "POOR_WEBSITE"] as const;
    for (const s of scenarios) if (!(await pickTemplate(wsId, s, null, c.templateId))) errors.push(`No ${s} template exists.`);
    return { ok: errors.length === 0, errors, warnings, optInRegion: regionWarnings.length > 0 };
  });

  // ---- Lead email thread, manual reply logging, erasure ----
  r.get("/leads/:id/emails", { ...auth, schema: { params: idParam, tags: ["leads"] } }, async (req) => {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!lead) throw new HttpError(404, "Lead not found");
    const [messages, drafts] = await Promise.all([
      prisma.emailMessage.findMany({
        where: { leadId: lead.id, workspaceId: req.auth.workspaceId },
        orderBy: { createdAt: "asc" },
        include: { events: { orderBy: { occurredAt: "asc" }, select: { type: true, occurredAt: true } }, draft: { select: { subject: true, step: true, bodyText: true } } },
      }),
      prisma.emailDraft.findMany({
        where: { leadId: lead.id, workspaceId: req.auth.workspaceId, status: { in: ["PENDING_REVIEW", "APPROVED", "QUEUED", "FAILED", "REJECTED"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, subject: true, step: true, status: true, lastError: true },
      }),
    ]);
    return { messages, drafts };
  });

  r.post(
    "/leads/:id/log-reply",
    { ...auth, schema: { params: idParam, body: z.object({ body: z.string().max(10000).optional() }), tags: ["leads"] } },
    async (req) => {
      const wsId = req.auth.workspaceId;
      const lead = await prisma.lead.findFirst({ where: { id: req.params.id, workspaceId: wsId }, include: { contacts: { where: { type: "EMAIL" }, take: 1 } } });
      if (!lead) throw new HttpError(404, "Lead not found");
      const last = await prisma.emailMessage.findFirst({ where: { leadId: lead.id, direction: "OUT" }, orderBy: { createdAt: "desc" } });
      if (!last) throw new HttpError(409, "No email has been sent to this lead yet");
      await prisma.emailMessage.create({
        data: { workspaceId: wsId, leadId: lead.id, direction: "IN", toEmail: lead.contacts[0]?.value ?? last.toEmail, status: "received", body: req.body.body, threadKey: last.threadKey, sentAt: new Date() },
      });
      return applyEmailEvent({ messageId: last.id, type: "REPLY", payload: { manual: true } });
    },
  );

  /** Erases a lead and everything attached to it, and suppresses its addresses so it is never re-created and emailed. */
  async function eraseLeads(workspaceId: string, leadIds: string[]) {
    let erased = 0;
    for (const id of leadIds) {
      const contacts = await prisma.leadContact.findMany({ where: { leadId: id, type: "EMAIL" } });
      for (const c of contacts) {
        await prisma.suppression.upsert({
          where: { workspaceId_value: { workspaceId, value: c.normalizedValue } },
          create: { workspaceId, value: c.normalizedValue, reason: "DELETION", source: "data-deletion" },
          update: {},
        });
      }
      await cancelPendingDrafts(workspaceId, id, "data deletion");
      await prisma.lead.delete({ where: { id } }); // cascades to audits, contacts, drafts, messages, events, notes, history
      erased++;
    }
    return erased;
  }

  r.delete("/leads/:id/data", { ...auth, schema: { params: idParam, tags: ["compliance"] } }, async (req) => {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!lead) throw new HttpError(404, "Lead not found");
    return { erased: await eraseLeads(req.auth.workspaceId, [lead.id]) };
  });

  r.post(
    "/data-deletion",
    { ...auth, schema: { body: z.object({ email: z.string().email().optional(), domain: z.string().min(3).optional() }).refine((b) => b.email || b.domain, "email or domain required"), tags: ["compliance"] } },
    async (req) => {
      const wsId = req.auth.workspaceId;
      const email = req.body.email ? normalizeEmail(req.body.email) : null;
      const domain = req.body.domain?.toLowerCase().replace(/^@/, "");
      const contacts = await prisma.leadContact.findMany({
        where: { workspaceId: wsId, type: "EMAIL", ...(email ? { normalizedValue: email } : { normalizedValue: { endsWith: `@${domain}` } }) },
        select: { leadId: true },
      });
      const erased = await eraseLeads(wsId, [...new Set(contacts.map((c) => c.leadId))]);
      // Suppress the address/domain itself even if we hold no lead, so a future discovery run cannot email it.
      const value = email ?? domain!;
      await prisma.suppression.upsert({
        where: { workspaceId_value: { workspaceId: wsId, value } },
        create: { workspaceId: wsId, value, reason: "DELETION", source: "data-deletion" },
        update: {},
      });
      return { erased, suppressed: value };
    },
  );

  // ---- Dev only: fake provider webhook events when using the console email provider ----
  if (env.NODE_ENV !== "production" && env.EMAIL_PROVIDER === "console") {
    r.post(
      "/dev/simulate-event",
      {
        ...auth,
        schema: { body: z.object({ messageId: z.string(), type: z.enum(["DELIVERED", "OPEN", "CLICK", "BOUNCE", "SPAM", "UNSUBSCRIBE", "REPLY"]) }), tags: ["dev"] },
      },
      async (req) => {
        const m = await prisma.emailMessage.findFirst({ where: { id: req.body.messageId, workspaceId: req.auth.workspaceId } });
        if (!m) throw new HttpError(404, "Message not found");
        return applyEmailEvent({ messageId: m.id, type: req.body.type, payload: { simulated: true } });
      },
    );
  }
};
