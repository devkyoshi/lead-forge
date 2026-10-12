import type { EmailEventType, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { cancelPendingDrafts, suppressLead } from "./compliance.js";
import { changeLeadStatus } from "./leads.js";

/**
 * Applies one delivery/engagement event to a message and its lead. Idempotent on
 * providerEventId, so provider webhook retries are safe.
 */
export async function applyEmailEvent(opts: {
  messageId: string;
  type: EmailEventType;
  providerEventId?: string;
  payload?: Prisma.InputJsonValue;
  occurredAt?: Date;
}) {
  const message = await prisma.emailMessage.findUnique({ where: { id: opts.messageId } });
  if (!message) return { applied: false, reason: "unknown message" };

  if (opts.providerEventId) {
    const dup = await prisma.emailEvent.findUnique({ where: { providerEventId: opts.providerEventId } });
    if (dup) return { applied: false, reason: "duplicate event" };
  }
  await prisma.emailEvent.create({
    data: {
      workspaceId: message.workspaceId,
      messageId: message.id,
      type: opts.type,
      providerEventId: opts.providerEventId,
      payload: opts.payload,
      occurredAt: opts.occurredAt ?? new Date(),
    },
  });

  const { workspaceId, leadId } = message;
  switch (opts.type) {
    case "DELIVERED":
      await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "delivered" } });
      break;
    case "BOUNCE":
      await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "bounced" } });
      await suppressLead({ workspaceId, leadId, reason: "BOUNCE", actor: "system", email: message.toEmail });
      break;
    case "SPAM":
      await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "spam" } });
      await suppressLead({ workspaceId, leadId, reason: "SPAM", status: "UNSUBSCRIBED", actor: "system", email: message.toEmail });
      break;
    case "UNSUBSCRIBE":
      await suppressLead({ workspaceId, leadId, reason: "UNSUBSCRIBE", actor: "system", email: message.toEmail });
      break;
    case "REPLY": {
      await cancelPendingDrafts(workspaceId, leadId, "lead replied");
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true } });
      if (lead && ["NEW", "QUALIFIED", "CONTACTED"].includes(lead.status)) {
        await changeLeadStatus(workspaceId, leadId, { status: "REPLIED" }, "system");
      }
      break;
    }
    default:
      break; // OPEN / CLICK are recorded only
  }
  return { applied: true };
}
