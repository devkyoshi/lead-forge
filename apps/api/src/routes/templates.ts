import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { TONES, markdownToHtml } from "@leadforge/shared";
import { prisma } from "../db.js";
import { buildEmail, createTemplate } from "../services/drafts.js";
import { HttpError } from "../services/leads.js";

const idParam = z.object({ id: z.string().min(1) });
const scenario = z.enum(["NO_WEBSITE", "POOR_WEBSITE", "FOLLOWUP_1", "FOLLOWUP_2"]);

const createBody = z.object({
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(40).default("generic"),
  scenario,
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
});

export const templateRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  async function getTemplate(workspaceId: string, id: string) {
    const t = await prisma.emailTemplate.findFirst({ where: { id, workspaceId } });
    if (!t) throw new HttpError(404, "Template not found");
    return t;
  }

  r.get("/templates", { ...auth, schema: { tags: ["templates"] } }, async (req) => {
    const items = await prisma.emailTemplate.findMany({
      where: { workspaceId: req.auth.workspaceId, archived: false },
      orderBy: [{ scenario: "asc" }, { createdAt: "asc" }],
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    return { items };
  });

  r.post("/templates", { ...auth, schema: { body: createBody, tags: ["templates"] } }, async (req, reply) => {
    const { body, ...rest } = req.body;
    const t = await createTemplate(req.auth.workspaceId, { ...rest, body }, req.auth.userId);
    return reply.status(201).send(t);
  });

  r.get("/templates/:id", { ...auth, schema: { params: idParam, tags: ["templates"] } }, async (req) => {
    await getTemplate(req.auth.workspaceId, req.params.id);
    return prisma.emailTemplate.findFirstOrThrow({
      where: { id: req.params.id, workspaceId: req.auth.workspaceId },
      include: { versions: { orderBy: { version: "desc" } } },
    });
  });

  r.patch(
    "/templates/:id",
    {
      ...auth,
      schema: {
        params: idParam,
        body: z.object({ name: z.string().min(1).max(120), category: z.string().min(1).max(40), scenario, archived: z.boolean() }).partial(),
        tags: ["templates"],
      },
    },
    async (req) => {
      await getTemplate(req.auth.workspaceId, req.params.id);
      return prisma.emailTemplate.update({ where: { id: req.params.id }, data: req.body });
    },
  );

  r.delete("/templates/:id", { ...auth, schema: { params: idParam, tags: ["templates"] } }, async (req) => {
    await getTemplate(req.auth.workspaceId, req.params.id);
    // Archive rather than delete: drafts and stats reference its versions.
    await prisma.emailTemplate.update({ where: { id: req.params.id }, data: { archived: true } });
    return { ok: true };
  });

  r.get("/templates/:id/versions", { ...auth, schema: { params: idParam, tags: ["templates"] } }, async (req) => {
    await getTemplate(req.auth.workspaceId, req.params.id);
    return prisma.emailTemplateVersion.findMany({ where: { templateId: req.params.id }, orderBy: { version: "desc" } });
  });

  r.post(
    "/templates/:id/versions",
    {
      ...auth,
      schema: { params: idParam, body: z.object({ subject: z.string().min(1).max(300), body: z.string().min(1).max(20000) }), tags: ["templates"] },
    },
    async (req, reply) => {
      const tpl = await getTemplate(req.auth.workspaceId, req.params.id);
      const v = await prisma.$transaction(async (tx) => {
        const last = await tx.emailTemplateVersion.findFirst({ where: { templateId: tpl.id }, orderBy: { version: "desc" } });
        const created = await tx.emailTemplateVersion.create({
          data: {
            workspaceId: tpl.workspaceId,
            templateId: tpl.id,
            version: (last?.version ?? 0) + 1,
            subject: req.body.subject,
            bodyMd: req.body.body,
            createdBy: req.auth.userId,
          },
        });
        await tx.emailTemplate.update({ where: { id: tpl.id }, data: { currentVersionId: created.id } });
        return created;
      });
      return reply.status(201).send(v);
    },
  );

  /** Live preview against a real lead. Does not save anything. */
  r.post(
    "/templates/preview",
    {
      ...auth,
      schema: {
        body: z.object({
          leadId: z.string().min(1),
          subject: z.string().max(300),
          body: z.string().max(20000),
          tone: z.enum(TONES).default("friendly"),
          ai: z.boolean().default(false),
        }),
        tags: ["templates"],
      },
    },
    async (req) => {
      const lead = await prisma.lead.findFirst({ where: { id: req.body.leadId, workspaceId: req.auth.workspaceId, deletedAt: null } });
      if (!lead) throw new HttpError(404, "Lead not found");
      const built = await buildEmail({ lead, subjectTpl: req.body.subject, bodyTpl: req.body.body, tone: req.body.tone, aiPersonalize: req.body.ai });
      return { subject: built.subject, bodyText: built.bodyText, bodyHtml: built.bodyHtml, aiGenerated: built.aiGenerated, warnings: built.warnings };
    },
  );

  /** Sent / opened / replied / converted counts for messages that used any version of this template. */
  r.get("/templates/:id/stats", { ...auth, schema: { params: idParam, tags: ["templates"] } }, async (req) => {
    await getTemplate(req.auth.workspaceId, req.params.id);
    const drafts = await prisma.emailDraft.findMany({
      where: { workspaceId: req.auth.workspaceId, version: { templateId: req.params.id } },
      select: { id: true, status: true, leadId: true, messages: { select: { id: true, events: { select: { type: true } } } } },
    });
    const messages = drafts.flatMap((d) => d.messages);
    const has = (t: string) => messages.filter((m) => m.events.some((e) => e.type === t)).length;
    const converted = await prisma.lead.count({
      where: { workspaceId: req.auth.workspaceId, status: "CONFIRMED", id: { in: drafts.map((d) => d.leadId) } },
    });
    return { drafts: drafts.length, sent: messages.length, opened: has("OPEN"), replied: has("REPLY"), converted };
  });

  void markdownToHtml;
};
