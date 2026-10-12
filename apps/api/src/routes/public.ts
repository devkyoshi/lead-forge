import { createPublicKey, verify } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import type { EmailEventType } from "@prisma/client";
import { normalizeEmail } from "@leadforge/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { inboundKey, verifyUnsubToken } from "../lib/unsub.js";
import { suppressLead } from "../services/compliance.js";
import { applyEmailEvent } from "../services/events.js";

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111}button{font-size:1rem;padding:.6rem 1.2rem;border-radius:.4rem;border:0;background:#111;color:#fff;cursor:pointer}</style>
</head><body>${body}</body></html>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** SendGrid event name -> our event type. Soft events (deferred, processed, dropped) are ignored. */
const SENDGRID_EVENTS: Record<string, EmailEventType> = {
  delivered: "DELIVERED",
  open: "OPEN",
  click: "CLICK",
  bounce: "BOUNCE",
  spamreport: "SPAM",
  unsubscribe: "UNSUBSCRIBE",
  group_unsubscribe: "UNSUBSCRIBE",
};

function verifySendGridSignature(rawBody: string, signature: string | undefined, timestamp: string | undefined): boolean {
  if (!env.SENDGRID_WEBHOOK_PUBLIC_KEY) return env.NODE_ENV !== "production"; // unsigned only tolerated in dev
  if (!signature || !timestamp) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(env.SENDGRID_WEBHOOK_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function parseFromAddress(from: string): string | null {
  const m = /<([^>]+)>/.exec(from) ?? /([^\s<>]+@[^\s<>]+)/.exec(from);
  return m?.[1] ? normalizeEmail(m[1]) : null;
}

/** Unauthenticated endpoints: unsubscribe pages and provider webhooks. */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  // One-click unsubscribe (RFC 8058) and the HTML form both post urlencoded data.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));
  await app.register(multipart, { limits: { fileSize: 1_000_000, files: 0 } });

  // ---- Unsubscribe ----
  app.get<{ Params: { token: string } }>("/u/:token", { schema: { tags: ["public"], security: [], description: "Unsubscribe confirmation page (HTML)" } }, async (req, reply) => {
    const t = verifyUnsubToken(req.params.token);
    reply.type("text/html");
    if (!t) return reply.status(400).send(page("Invalid link", "<h1>This link is not valid</h1><p>It may have been copied incorrectly.</p>"));
    const lead = await prisma.lead.findFirst({ where: { id: t.leadId, workspaceId: t.workspaceId }, select: { name: true, status: true } });
    if (!lead) return page("Unsubscribed", "<h1>You are not on our list</h1><p>We hold no record for this address.</p>");
    if (lead.status === "UNSUBSCRIBED") return page("Unsubscribed", "<h1>You are already unsubscribed</h1><p>You will not receive further emails from us.</p>");
    return page(
      "Unsubscribe",
      `<h1>Unsubscribe</h1><p>Stop all emails to <strong>${esc(lead.name)}</strong>?</p><form method="post"><button type="submit">Yes, unsubscribe</button></form>`,
    );
  });

  app.post<{ Params: { token: string } }>("/u/:token", { schema: { tags: ["public"], security: [], description: "Performs the unsubscribe. Also accepts RFC 8058 one-click POSTs." } }, async (req, reply) => {
    const t = verifyUnsubToken(req.params.token);
    if (!t) return reply.status(400).type("text/html").send(page("Invalid link", "<h1>This link is not valid</h1>"));
    await suppressLead({ workspaceId: t.workspaceId, leadId: t.leadId, reason: "UNSUBSCRIBE", actor: "recipient" });
    return reply.type("text/html").send(page("Unsubscribed", "<h1>You have been unsubscribed</h1><p>You will not receive any more emails from us. Sorry for the interruption.</p>"));
  });

  // ---- SendGrid Event Webhook ----
  app.post("/webhooks/sendgrid/events", { schema: { tags: ["public"], security: [], description: "SendGrid Event Webhook. Verified with the ECDSA signature headers." } }, async (req, reply) => {
    const ok = verifySendGridSignature(
      req.rawBody ?? "",
      req.headers["x-twilio-email-event-webhook-signature"] as string | undefined,
      req.headers["x-twilio-email-event-webhook-timestamp"] as string | undefined,
    );
    if (!ok) return reply.status(401).send({ error: "Invalid signature" });
    const events = Array.isArray(req.body) ? (req.body as Record<string, unknown>[]) : [];
    let applied = 0;
    for (const ev of events) {
      const type = SENDGRID_EVENTS[String(ev.event)];
      if (!type) continue;
      let messageId = typeof ev.message_id === "string" ? ev.message_id : undefined;
      if (!messageId && typeof ev.sg_message_id === "string") {
        const base = ev.sg_message_id.split(".")[0]!;
        messageId = (await prisma.emailMessage.findFirst({ where: { providerMessageId: base }, select: { id: true } }))?.id;
      }
      if (!messageId) continue;
      const r = await applyEmailEvent({
        messageId,
        type,
        providerEventId: typeof ev.sg_event_id === "string" ? ev.sg_event_id : undefined,
        payload: ev as never,
        occurredAt: typeof ev.timestamp === "number" ? new Date(ev.timestamp * 1000) : undefined,
      });
      if (r.applied) applied++;
    }
    return { received: events.length, applied };
  });

  // ---- SendGrid Inbound Parse: replies ----
  app.post<{ Querystring: { key?: string } }>("/webhooks/sendgrid/inbound", { schema: { tags: ["public"], security: [], description: "SendGrid Inbound Parse (replies). Protected by a secret key in the URL." } }, async (req, reply) => {
    if (req.query.key !== inboundKey()) return reply.status(401).send({ error: "Invalid key" });
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) if (part.type === "field") fields[part.fieldname] = String(part.value);
    const fromEmail = fields.from ? parseFromAddress(fields.from) : null;
    if (!fromEmail) return { ok: true, matched: false };

    const contact = await prisma.leadContact.findFirst({ where: { type: "EMAIL", normalizedValue: fromEmail }, orderBy: { createdAt: "desc" } });
    if (!contact) return { ok: true, matched: false };
    const last = await prisma.emailMessage.findFirst({ where: { leadId: contact.leadId, direction: "OUT" }, orderBy: { createdAt: "desc" } });
    if (!last) return { ok: true, matched: false };

    await prisma.emailMessage.create({
      data: { workspaceId: last.workspaceId, leadId: last.leadId, direction: "IN", toEmail: fromEmail, status: "received", body: (fields.text ?? "").slice(0, 20000), threadKey: last.threadKey, sentAt: new Date() },
    });
    await applyEmailEvent({ messageId: last.id, type: "REPLY", payload: { subject: fields.subject ?? null } });
    return { ok: true, matched: true };
  });
};
