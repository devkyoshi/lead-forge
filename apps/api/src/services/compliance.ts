import type { LeadStatus, SuppressionReason } from "@prisma/client";
import { normalizeEmail } from "@leadforge/shared";
import { prisma } from "../db.js";

/**
 * Permanently stops all email to a lead: suppresses every address we hold for them, sets the
 * status (bypassing the pipeline transition rules, because this is a compliance event that must
 * always win), and cancels any draft that has not been sent. Idempotent.
 */
export async function suppressLead(opts: {
  workspaceId: string;
  leadId: string;
  reason: SuppressionReason;
  status?: Extract<LeadStatus, "UNSUBSCRIBED" | "BOUNCED">;
  actor: string;
  /** Specific address that triggered it (e.g. the bounced address). */
  email?: string;
}) {
  const { workspaceId, leadId } = opts;
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, include: { contacts: { where: { type: "EMAIL" } } } });
  if (!lead) return null;

  // A bounce only suppresses the bounced address; unsubscribe/spam suppress every address for the lead.
  const addresses = new Set(
    opts.reason === "BOUNCE" && opts.email ? [normalizeEmail(opts.email)] : lead.contacts.map((c) => c.normalizedValue),
  );
  if (opts.email) addresses.add(normalizeEmail(opts.email));
  for (const value of addresses) {
    await prisma.suppression.upsert({
      where: { workspaceId_value: { workspaceId, value } },
      create: { workspaceId, value, reason: opts.reason, source: opts.actor },
      update: {},
    });
  }

  const status = opts.status ?? (opts.reason === "BOUNCE" ? "BOUNCED" : "UNSUBSCRIBED");
  if (lead.status !== status) {
    await prisma.$transaction([
      prisma.lead.update({ where: { id: leadId }, data: { status } }),
      prisma.leadStatusHistory.create({
        data: { workspaceId, leadId, fromStatus: lead.status, toStatus: status, actor: opts.actor, reason: `Email ${opts.reason.toLowerCase()}` },
      }),
    ]);
  }
  await cancelPendingDrafts(workspaceId, leadId, `lead ${status.toLowerCase()}`);
  return status;
}

/** Halts automated outreach: unsent drafts are rejected so a worker can never pick them up. */
export async function cancelPendingDrafts(workspaceId: string, leadId: string, why: string, steps?: { gt: number }) {
  const res = await prisma.emailDraft.updateMany({
    where: { workspaceId, leadId, status: { in: ["PENDING_REVIEW", "APPROVED", "QUEUED"] }, ...(steps ? { step: steps } : {}) },
    data: { status: "REJECTED", lastError: why },
  });
  return res.count;
}
