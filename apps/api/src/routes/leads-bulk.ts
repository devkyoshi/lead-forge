import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { leadListQuerySchema, leadStatusSchema, statusChangeSchema } from "@leadforge/shared";
import { prisma } from "../db.js";
import { HttpError, changeLeadStatus } from "../services/leads.js";
import { buildLeadWhere, csvCell } from "../services/lead-query.js";

const bulkBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_status"),
    ids: z.array(z.string()).min(1).max(500),
    status: leadStatusSchema,
    reason: z.string().max(500).optional(),
    project: statusChangeSchema.shape.project,
  }),
  z.object({ action: z.literal("add_tag"), ids: z.array(z.string()).min(1).max(500), tag: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("remove_tag"), ids: z.array(z.string()).min(1).max(500), tag: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("assign"), ids: z.array(z.string()).min(1).max(500), assignedTo: z.string().nullable() }),
]);

const CSV_COLUMNS = [
  "name", "category", "area", "address", "phone", "email", "websiteUrl", "websiteStatus", "websiteScore",
  "rating", "reviewCount", "score", "status", "tags", "assignedTo", "needsManualOutreach", "createdAt",
] as const;

export const leadBulkRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  /** Workspace members, for the "assigned to" picker. */
  r.get("/team", { ...auth, schema: { tags: ["leads"] } }, async (req) => ({
    items: await prisma.user.findMany({ where: { workspaceId: req.auth.workspaceId }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  }));

  /**
   * Apply one action to many leads. Each lead is handled independently and the response lists what
   * changed and what was skipped (and why), so one invalid lead never blocks the rest.
   */
  r.post("/leads/bulk", { ...auth, schema: { body: bulkBody, tags: ["leads"] } }, async (req) => {
    const wsId = req.auth.workspaceId;
    const b = req.body;
    const leads = await prisma.lead.findMany({ where: { id: { in: b.ids }, workspaceId: wsId, deletedAt: null }, select: { id: true, name: true, tags: true } });
    const found = new Set(leads.map((l) => l.id));
    const skipped: { id: string; name?: string; reason: string }[] = b.ids.filter((id) => !found.has(id)).map((id) => ({ id, reason: "not found" }));
    let changed = 0;

    if (b.action === "assign" && b.assignedTo) {
      const member = await prisma.user.findFirst({ where: { id: b.assignedTo, workspaceId: wsId } });
      if (!member) throw new HttpError(422, "That user is not in this workspace");
    }

    for (const lead of leads) {
      try {
        if (b.action === "set_status") {
          await changeLeadStatus(wsId, lead.id, { status: b.status, reason: b.reason, project: b.project }, req.auth.userId);
        } else if (b.action === "add_tag") {
          if (lead.tags.includes(b.tag)) continue;
          await prisma.lead.update({ where: { id: lead.id }, data: { tags: { push: b.tag } } });
        } else if (b.action === "remove_tag") {
          if (!lead.tags.includes(b.tag)) continue;
          await prisma.lead.update({ where: { id: lead.id }, data: { tags: lead.tags.filter((t) => t !== b.tag) } });
        } else {
          await prisma.lead.update({ where: { id: lead.id }, data: { assignedTo: b.assignedTo } });
        }
        changed++;
      } catch (e) {
        skipped.push({ id: lead.id, name: lead.name, reason: e instanceof HttpError ? e.message : "failed" });
      }
    }
    return { changed, skipped };
  });

  /** CSV of every lead matching the current filters (not just the visible page). */
  r.get("/leads/export.csv", { ...auth, schema: { querystring: leadListQuerySchema.omit({ page: true, pageSize: true }), tags: ["leads"] } }, async (req, reply) => {
    const rows = await prisma.lead.findMany({
      where: buildLeadWhere(req.auth.workspaceId, req.query),
      orderBy: { [req.query.sort]: req.query.dir },
      take: 20_000,
      include: { contacts: { where: { type: "EMAIL" }, orderBy: { confidence: "desc" }, take: 1 } },
    });
    const lines = [CSV_COLUMNS.join(",")];
    for (const l of rows) {
      const flat: Record<string, unknown> = { ...l, email: l.contacts[0]?.value ?? "" };
      lines.push(CSV_COLUMNS.map((c) => csvCell(flat[c])).join(","));
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send("﻿" + lines.join("\r\n") + "\r\n");
  });
};
