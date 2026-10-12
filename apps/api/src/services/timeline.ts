import { prisma } from "../db.js";

export interface TimelineEntry {
  at: Date;
  kind: "created" | "status" | "audit" | "email_sent" | "email_event" | "reply" | "note" | "draft";
  title: string;
  detail?: string;
  /** Who did it: a user id, "system", or "recipient". */
  actor?: string;
}

const EVENT_TITLES: Record<string, string> = {
  DELIVERED: "Email delivered",
  OPEN: "Email opened",
  CLICK: "Link clicked",
  BOUNCE: "Email bounced",
  SPAM: "Marked as spam",
  UNSUBSCRIBE: "Unsubscribed",
  REPLY: "Reply received",
};

/** One chronological activity feed for a lead: status changes, audits, emails and their events, replies, notes. */
export async function buildTimeline(workspaceId: string, leadId: string): Promise<TimelineEntry[]> {
  const [history, audits, messages, notes, drafts, users] = await Promise.all([
    prisma.leadStatusHistory.findMany({ where: { workspaceId, leadId } }),
    prisma.leadAudit.findMany({ where: { workspaceId, leadId } }),
    prisma.emailMessage.findMany({
      where: { workspaceId, leadId },
      include: { events: true, draft: { select: { subject: true, step: true } } },
    }),
    prisma.leadNote.findMany({ where: { workspaceId, leadId } }),
    prisma.emailDraft.findMany({ where: { workspaceId, leadId }, select: { createdAt: true, subject: true, step: true, aiGenerated: true } }),
    prisma.user.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  const who = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const out: TimelineEntry[] = [];

  for (const h of history) {
    out.push({
      at: h.createdAt,
      kind: h.fromStatus ? "status" : "created",
      title: h.fromStatus ? `Status: ${h.fromStatus} → ${h.toStatus}` : `Lead added as ${h.toStatus}`,
      detail: h.reason ?? undefined,
      actor: h.actor === "system" || h.actor === "recipient" ? h.actor : who(h.actor),
    });
  }
  for (const a of audits) {
    out.push({
      at: a.fetchedAt,
      kind: "audit",
      title: `Website audited: ${a.websiteStatus.replace("_", " ").toLowerCase()}${a.websiteScore != null ? ` (score ${a.websiteScore})` : ""}`,
      actor: "system",
    });
  }
  for (const d of drafts) {
    out.push({ at: d.createdAt, kind: "draft", title: `${d.step ? `Follow-up ${d.step}` : "Email"} drafted${d.aiGenerated ? " with AI" : ""}`, detail: d.subject, actor: "system" });
  }
  for (const m of messages) {
    if (m.direction === "IN") {
      out.push({ at: m.sentAt ?? m.createdAt, kind: "reply", title: "Reply received", detail: m.body?.slice(0, 200) ?? undefined, actor: "recipient" });
      continue;
    }
    if (m.sentAt) {
      out.push({ at: m.sentAt, kind: "email_sent", title: `${m.draft?.step ? `Follow-up ${m.draft.step}` : "Email"} sent to ${m.toEmail}`, detail: m.draft?.subject, actor: "system" });
    }
    // The reply event duplicates the IN message above, so it is skipped here.
    for (const e of m.events.filter((x) => x.type !== "REPLY")) {
      out.push({ at: e.occurredAt, kind: "email_event", title: EVENT_TITLES[e.type] ?? e.type, detail: m.draft?.subject, actor: "recipient" });
    }
  }
  for (const n of notes) out.push({ at: n.createdAt, kind: "note", title: "Note added", detail: n.body, actor: who(n.authorId) });

  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}
