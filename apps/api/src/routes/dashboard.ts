import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { localParts, type LeadStatus } from "@leadforge/shared";
import { prisma } from "../db.js";
import { getSendStatus } from "../services/sender.js";

/** A lead counts at a funnel stage if it ever reached that stage or any later one. */
const REACHED: Record<string, LeadStatus[]> = {
  qualified: ["QUALIFIED", "CONTACTED", "REPLIED", "INTERESTED", "PROPOSAL_SENT", "NEGOTIATING", "CONFIRMED"],
  contacted: ["CONTACTED", "REPLIED", "INTERESTED", "PROPOSAL_SENT", "NEGOTIATING", "CONFIRMED"],
  replied: ["REPLIED", "INTERESTED", "PROPOSAL_SENT", "NEGOTIATING", "CONFIRMED"],
  confirmed: ["CONFIRMED"],
};

const DAYS = 14;

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/dashboard/summary", { preHandler: app.authenticate, schema: { tags: ["dashboard"] } }, async (req) => {
    const workspaceId = req.auth.workspaceId;
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
    const now = new Date();

    const reachedCount = async (statuses: LeadStatus[]) =>
      (await prisma.leadStatusHistory.groupBy({ by: ["leadId"], where: { workspaceId, toStatus: { in: statuses }, lead: { deletedAt: null } } })).length;

    const [discovered, qualified, contacted, replied, confirmed, send, runs, confirmedLeads, sentRecent, templates] = await Promise.all([
      prisma.lead.count({ where: { workspaceId, deletedAt: null } }),
      reachedCount(REACHED.qualified!),
      reachedCount(REACHED.contacted!),
      reachedCount(REACHED.replied!),
      reachedCount(REACHED.confirmed!),
      getSendStatus(workspaceId, now),
      prisma.campaignRun.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { campaign: { select: { id: true, name: true } } },
      }),
      prisma.lead.findMany({ where: { workspaceId, deletedAt: null, status: "CONFIRMED" }, select: { project: true } }),
      prisma.emailMessage.findMany({
        where: { workspaceId, direction: "OUT", sentAt: { gte: new Date(now.getTime() - (DAYS + 1) * 86_400_000) } },
        select: { sentAt: true },
      }),
      prisma.emailTemplate.findMany({ where: { workspaceId }, select: { id: true, name: true, scenario: true } }),
    ]);

    // Emails sent per local day for the last DAYS days (zero-filled so the chart has no gaps).
    const keyOf = (d: Date) => {
      const p = localParts(ws.timezone, d);
      return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    };
    const perDay = new Map<string, number>();
    for (let i = DAYS - 1; i >= 0; i--) perDay.set(keyOf(new Date(now.getTime() - i * 86_400_000)), 0);
    for (const m of sentRecent) {
      const k = keyOf(m.sentAt!);
      if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }

    // Template performance: sent / opened / replied / converted, joined through drafts.
    const drafts = await prisma.emailDraft.findMany({
      where: { workspaceId, version: { isNot: null } },
      select: { leadId: true, version: { select: { templateId: true } }, messages: { select: { events: { select: { type: true } } } } },
    });
    const confirmedIds = new Set(
      (await prisma.lead.findMany({ where: { workspaceId, status: "CONFIRMED" }, select: { id: true } })).map((l) => l.id),
    );
    const stats = new Map<string, { sent: number; opened: number; replied: number; converted: number }>();
    for (const d of drafts) {
      const tid = d.version!.templateId;
      const s = stats.get(tid) ?? { sent: 0, opened: 0, replied: 0, converted: 0 };
      for (const m of d.messages) {
        s.sent++;
        if (m.events.some((e) => e.type === "OPEN")) s.opened++;
        if (m.events.some((e) => e.type === "REPLY")) s.replied++;
      }
      if (d.messages.length && confirmedIds.has(d.leadId)) s.converted++;
      stats.set(tid, s);
    }
    const topTemplates = templates
      .map((t) => ({ ...t, ...(stats.get(t.id) ?? { sent: 0, opened: 0, replied: 0, converted: 0 }) }))
      .sort((a, b) => b.replied - a.replied || b.sent - a.sent)
      .slice(0, 5);

    const confirmedValue = confirmedLeads.reduce((sum, l) => sum + Number((l.project as { value?: number } | null)?.value ?? 0), 0);

    return {
      funnel: [
        { key: "discovered", label: "Discovered", count: discovered },
        { key: "qualified", label: "Qualified", count: qualified },
        { key: "contacted", label: "Contacted", count: contacted },
        { key: "replied", label: "Replied", count: replied },
        { key: "confirmed", label: "Confirmed", count: confirmed },
      ],
      kpis: {
        totalLeads: discovered,
        replyRate: contacted ? replied / contacted : 0,
        confirmedValue,
        pendingReview: send.pendingReview,
      },
      send,
      emailsPerDay: [...perDay].map(([date, count]) => ({ date, count })),
      runs,
      topTemplates,
    };
  });
};
