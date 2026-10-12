import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { LEAD_STATUSES, type LeadStatus } from "@leadforge/shared";
import { prisma } from "../db.js";

const PER_COLUMN = 40;

export const pipelineRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Kanban data: every status with its total count and the top leads in it. */
  r.get(
    "/pipeline",
    { preHandler: app.authenticate, schema: { querystring: z.object({ campaignId: z.string().optional(), q: z.string().optional() }), tags: ["pipeline"] } },
    async (req) => {
      const base = {
        workspaceId: req.auth.workspaceId,
        deletedAt: null,
        ...(req.query.campaignId ? { campaignId: req.query.campaignId } : {}),
        ...(req.query.q ? { name: { contains: req.query.q, mode: "insensitive" as const } } : {}),
      };
      const columns = await Promise.all(
        LEAD_STATUSES.map(async (status: LeadStatus) => {
          const [count, items] = await Promise.all([
            prisma.lead.count({ where: { ...base, status } }),
            prisma.lead.findMany({
              where: { ...base, status },
              orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
              take: PER_COLUMN,
              select: {
                id: true,
                name: true,
                category: true,
                area: true,
                score: true,
                rating: true,
                reviewCount: true,
                websiteStatus: true,
                assignedTo: true,
                tags: true,
                needsManualOutreach: true,
                updatedAt: true,
                checklist: { select: { done: true } },
              },
            }),
          ]);
          return {
            status,
            count,
            items: items.map(({ checklist, ...l }) => ({ ...l, checklistDone: checklist.filter((c) => c.done).length, checklistTotal: checklist.length })),
          };
        }),
      );
      return { columns, perColumn: PER_COLUMN };
    },
  );
};
