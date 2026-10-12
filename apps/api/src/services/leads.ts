import type { Prisma } from "@prisma/client";
import {
  DEFAULT_CHECKLIST,
  STATUS_CHECKLIST_TICKS,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  validateTransition,
  type LeadCreateInput,
  type LeadStatus,
  type StatusChangeInput,
} from "@leadforge/shared";
import { prisma } from "../db.js";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

async function checklistTemplate(tx: Tx, workspaceId: string) {
  const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { checklistDefaults: true } });
  const custom = ws?.checklistDefaults as { key: string; label: string }[] | null;
  return custom?.length ? custom : DEFAULT_CHECKLIST.map((c) => ({ ...c }));
}

export async function createLead(workspaceId: string, input: LeadCreateInput, actor: string) {
  const normalizedName = normalizeName(input.name);
  const normalizedAddress = input.address ? normalizeAddress(input.address) : "";
  const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;

  const dup = await prisma.lead.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [
        { normalizedName, normalizedAddress },
        ...(normalizedPhone ? [{ normalizedPhone }] : []),
      ],
    },
    select: { id: true },
  });
  if (dup) throw new HttpError(409, `Lead already exists (${dup.id})`);

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        workspaceId,
        name: input.name,
        normalizedName,
        address: input.address,
        normalizedAddress,
        phone: input.phone,
        normalizedPhone,
        category: input.category,
        area: input.area,
        websiteUrl: input.websiteUrl,
        websiteStatus: input.websiteUrl ? "UNKNOWN" : "NO_WEBSITE",
        rating: input.rating,
        reviewCount: input.reviewCount,
        tags: input.tags ?? [],
        source: "manual",
      },
    });
    const items = await checklistTemplate(tx, workspaceId);
    await tx.leadChecklistItem.createMany({
      data: items.map((c, i) => ({ workspaceId, leadId: lead.id, key: c.key, label: c.label, position: i })),
    });
    if (input.email) {
      await tx.leadContact.create({
        data: {
          workspaceId,
          leadId: lead.id,
          type: "EMAIL",
          value: input.email,
          normalizedValue: normalizeEmail(input.email),
          source: "manual",
          confidence: 1,
        },
      });
    }
    await tx.leadStatusHistory.create({
      data: { workspaceId, leadId: lead.id, toStatus: "NEW", actor, reason: "Lead created" },
    });
    return lead;
  });
}

/** Single entry point for status changes (API and workers). Logs history and ticks checklist. */
export async function changeLeadStatus(
  workspaceId: string,
  leadId: string,
  input: StatusChangeInput,
  actor: string,
) {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, workspaceId, deletedAt: null } });
    if (!lead) throw new HttpError(404, "Lead not found");
    const err = validateTransition(lead.status as LeadStatus, input.status, {
      reason: input.reason,
      project: input.project,
    });
    if (err) throw new HttpError(422, err);

    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        status: input.status,
        closedReason: input.reason ?? null,
        ...(input.project ? { project: input.project } : {}),
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        workspaceId,
        leadId,
        fromStatus: lead.status,
        toStatus: input.status,
        actor,
        reason: input.reason,
        meta: input.project ? { project: input.project } : undefined,
      },
    });
    const ticks = STATUS_CHECKLIST_TICKS[input.status];
    if (ticks?.length) {
      await tx.leadChecklistItem.updateMany({
        where: { leadId, workspaceId, key: { in: ticks }, done: false },
        data: { done: true, doneAt: new Date(), doneBy: "system" },
      });
    }
    return updated;
  });
}
