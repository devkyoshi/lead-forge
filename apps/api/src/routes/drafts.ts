import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { markdownToHtml } from "@leadforge/shared";
import { prisma } from "../db.js";
import { generateDraft } from "../services/drafts.js";
import { HttpError } from "../services/leads.js";
import { isSuppressed } from "../services/suppression.js";

const idParam = z.object({ id: z.string().min(1) });
const statusEnum = z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "QUEUED", "SENT", "FAILED"]);

export const draftRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  r.get(
    "/drafts",
    { ...auth, schema: { querystring: z.object({ status: statusEnum.optional(), campaignId: z.string().optional() }), tags: ["drafts"] } },
    async (req) => {
      const items = await prisma.emailDraft.findMany({
        where: {
          workspaceId: req.auth.workspaceId,
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(req.query.campaignId ? { campaignId: req.query.campaignId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          lead: {
            select: {
              id: true, name: true, category: true, area: true, score: true, websiteStatus: true,
              contacts: { where: { type: "EMAIL" }, take: 1, select: { value: true } },
            },
          },
          campaign: { select: { id: true, name: true } },
        },
      });
      return { items };
    },
  );

  r.patch(
    "/drafts/:id",
    {
      ...auth,
      schema: { params: idParam, body: z.object({ subject: z.string().min(1).max(300), bodyText: z.string().min(1).max(20000) }), tags: ["drafts"] },
    },
    async (req) => {
      const d = await prisma.emailDraft.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
      if (!d) throw new HttpError(404, "Draft not found");
      if (!["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(d.status)) throw new HttpError(409, `Draft is ${d.status} and can no longer be edited`);
      return prisma.emailDraft.update({
        where: { id: d.id },
        data: { subject: req.body.subject, bodyText: req.body.bodyText, bodyHtml: markdownToHtml(req.body.bodyText), status: "PENDING_REVIEW" },
      });
    },
  );

  r.post(
    "/drafts/bulk",
    {
      ...auth,
      schema: { body: z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(["approve", "reject", "regenerate"]) }), tags: ["drafts"] },
    },
    async (req) => {
      const drafts = await prisma.emailDraft.findMany({
        where: { id: { in: req.body.ids }, workspaceId: req.auth.workspaceId, status: { in: ["PENDING_REVIEW", "APPROVED", "REJECTED"] } },
        include: { lead: true, campaign: true },
      });
      let changed = 0;
      const skipped: { id: string; reason: string }[] = [];
      for (const d of drafts) {
        if (req.body.action === "reject") {
          await prisma.emailDraft.update({ where: { id: d.id }, data: { status: "REJECTED" } });
          changed++;
        } else if (req.body.action === "approve") {
          const to = await prisma.leadContact.findFirst({ where: { leadId: d.leadId, type: "EMAIL" }, orderBy: { confidence: "desc" } });
          if (!to) skipped.push({ id: d.id, reason: "lead has no email" });
          else if (await isSuppressed(req.auth.workspaceId, to.value)) skipped.push({ id: d.id, reason: "recipient is on the suppression list" });
          else {
            await prisma.emailDraft.update({ where: { id: d.id }, data: { status: "APPROVED" } });
            changed++;
          }
        } else {
          await generateDraft({ lead: d.lead, campaign: d.campaign, force: true });
          changed++;
        }
      }
      return { changed, skipped };
    },
  );

  /** "Queue email" from the leads table: creates a draft for each selected lead. */
  r.post(
    "/leads/queue-email",
    { ...auth, schema: { body: z.object({ ids: z.array(z.string()).min(1).max(200) }), tags: ["drafts"] } },
    async (req) => {
      const leads = await prisma.lead.findMany({
        where: { id: { in: req.body.ids }, workspaceId: req.auth.workspaceId, deletedAt: null },
        include: { campaign: true, contacts: { where: { type: "EMAIL" }, take: 1 } },
      });
      let created = 0;
      const skipped: { id: string; name: string; reason: string }[] = [];
      for (const lead of leads) {
        const email = lead.contacts[0]?.value;
        if (!email) skipped.push({ id: lead.id, name: lead.name, reason: "no public email (needs manual outreach)" });
        else if (await isSuppressed(req.auth.workspaceId, email)) skipped.push({ id: lead.id, name: lead.name, reason: "suppressed" });
        else if (["UNSUBSCRIBED", "BOUNCED"].includes(lead.status)) skipped.push({ id: lead.id, name: lead.name, reason: lead.status.toLowerCase() });
        else {
          const res = await generateDraft({ lead, campaign: lead.campaign });
          if (res.created) created++;
          else skipped.push({ id: lead.id, name: lead.name, reason: "draft already exists" });
        }
      }
      return { created, skipped };
    },
  );
};
