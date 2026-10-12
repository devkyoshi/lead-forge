import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  leadCreateSchema,
  leadListQuerySchema,
  leadUpdateSchema,
  noteCreateSchema,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  statusChangeSchema,
} from "@leadforge/shared";
import { prisma } from "../db.js";
import { HttpError, changeLeadStatus, createLead } from "../services/leads.js";
import { buildTimeline } from "../services/timeline.js";

const idParam = z.object({ id: z.string().min(1) });

export const leadRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  async function getLead(workspaceId: string, id: string) {
    const lead = await prisma.lead.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!lead) throw new HttpError(404, "Lead not found");
    return lead;
  }

  r.get("/leads", { ...auth, schema: { querystring: leadListQuerySchema, tags: ["leads"] } }, async (req) => {
    const q = req.query;
    const where: Prisma.LeadWhereInput = {
      workspaceId: req.auth.workspaceId,
      deletedAt: null,
      ...(q.status?.length ? { status: { in: q.status } } : {}),
      ...(q.websiteStatus ? { websiteStatus: q.websiteStatus } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.area ? { area: q.area } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.campaignId ? { campaignId: q.campaignId } : {}),
      ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { address: { contains: q.q, mode: "insensitive" } },
              { phone: { contains: q.q } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { [q.sort]: q.dir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { contacts: { where: { type: "EMAIL" }, take: 1 } },
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items };
  });

  r.post("/leads", { ...auth, schema: { body: leadCreateSchema, tags: ["leads"] } }, async (req, reply) => {
    const lead = await createLead(req.auth.workspaceId, req.body, req.auth.userId);
    return reply.status(201).send(lead);
  });

  r.get("/leads/:id", { ...auth, schema: { params: idParam, tags: ["leads"] } }, async (req) => {
    await getLead(req.auth.workspaceId, req.params.id);
    return prisma.lead.findFirstOrThrow({
      where: { id: req.params.id, workspaceId: req.auth.workspaceId },
      include: {
        contacts: true,
        checklist: { orderBy: { position: "asc" } },
        audits: { orderBy: { version: "desc" }, take: 1 },
        notes: { orderBy: { createdAt: "desc" } },
        history: { orderBy: { createdAt: "desc" } },
      },
    });
  });

  r.patch(
    "/leads/:id",
    { ...auth, schema: { params: idParam, body: leadUpdateSchema, tags: ["leads"] } },
    async (req) => {
      await getLead(req.auth.workspaceId, req.params.id);
      const { email: _email, ...b } = req.body;
      return prisma.lead.update({
        where: { id: req.params.id },
        data: {
          ...b,
          ...(b.name !== undefined ? { normalizedName: normalizeName(b.name) } : {}),
          ...(b.address !== undefined ? { normalizedAddress: normalizeAddress(b.address) } : {}),
          ...(b.phone !== undefined ? { normalizedPhone: normalizePhone(b.phone) } : {}),
        },
      });
    },
  );

  r.delete("/leads/:id", { ...auth, schema: { params: idParam, tags: ["leads"] } }, async (req) => {
    await getLead(req.auth.workspaceId, req.params.id);
    await prisma.lead.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });

  r.post(
    "/leads/:id/status",
    { ...auth, schema: { params: idParam, body: statusChangeSchema, tags: ["leads"] } },
    async (req) => changeLeadStatus(req.auth.workspaceId, req.params.id, req.body, req.auth.userId),
  );

  r.get("/leads/:id/notes", { ...auth, schema: { params: idParam, tags: ["leads"] } }, async (req) => {
    await getLead(req.auth.workspaceId, req.params.id);
    return prisma.leadNote.findMany({
      where: { leadId: req.params.id, workspaceId: req.auth.workspaceId },
      orderBy: { createdAt: "desc" },
    });
  });

  r.post(
    "/leads/:id/notes",
    { ...auth, schema: { params: idParam, body: noteCreateSchema, tags: ["leads"] } },
    async (req, reply) => {
      await getLead(req.auth.workspaceId, req.params.id);
      const note = await prisma.leadNote.create({
        data: {
          workspaceId: req.auth.workspaceId,
          leadId: req.params.id,
          authorId: req.auth.userId,
          body: req.body.body,
        },
      });
      return reply.status(201).send(note);
    },
  );

  r.patch(
    "/leads/:id/checklist/:key",
    {
      ...auth,
      schema: {
        params: z.object({ id: z.string(), key: z.string() }),
        body: z.object({ done: z.boolean() }),
        tags: ["leads"],
      },
    },
    async (req) => {
      await getLead(req.auth.workspaceId, req.params.id);
      const res = await prisma.leadChecklistItem.updateMany({
        where: { leadId: req.params.id, workspaceId: req.auth.workspaceId, key: req.params.key },
        data: {
          done: req.body.done,
          doneAt: req.body.done ? new Date() : null,
          doneBy: req.body.done ? req.auth.userId : null,
        },
      });
      if (!res.count) throw new HttpError(404, "Checklist item not found");
      return { ok: true };
    },
  );

  r.get("/leads/:id/timeline", { ...auth, schema: { params: idParam, tags: ["leads"] } }, async (req) => {
    await getLead(req.auth.workspaceId, req.params.id);
    return { items: await buildTimeline(req.auth.workspaceId, req.params.id) };
  });
};
