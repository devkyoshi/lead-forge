import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { campaignCreateSchema, campaignUpdateSchema, scoringWeightsSchema } from "@leadforge/shared";
import { prisma } from "../db.js";
import { enqueueRun } from "../queue.js";
import { HttpError } from "../services/leads.js";
import { loadScoring } from "../services/stages.js";

const idParam = z.object({ id: z.string().min(1) });
const ACTIVE = ["QUEUED", "RUNNING"] as const;

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  async function getCampaign(workspaceId: string, id: string) {
    const c = await prisma.campaign.findFirst({ where: { id, workspaceId } });
    if (!c) throw new HttpError(404, "Campaign not found");
    return c;
  }

  /** Creates a run and enqueues it; refuses if one is already active (safe to re-trigger). */
  async function startRun(workspaceId: string, campaignId: string, trigger: "MANUAL" | "CRON" | "API") {
    const active = await prisma.campaignRun.findFirst({ where: { campaignId, status: { in: [...ACTIVE] } } });
    if (active) throw new HttpError(409, `A run is already ${active.status.toLowerCase()} (${active.id})`);
    const run = await prisma.campaignRun.create({ data: { workspaceId, campaignId, trigger, status: "QUEUED", counts: {} } });
    await enqueueRun(run.id);
    return run;
  }

  r.get("/campaigns", { ...auth, schema: { tags: ["campaigns"] } }, async (req) => {
    const items = await prisma.campaign.findMany({
      where: { workspaceId: req.auth.workspaceId },
      orderBy: { createdAt: "desc" },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { leads: true } } },
    });
    return { items };
  });

  r.post("/campaigns", { ...auth, schema: { body: campaignCreateSchema, tags: ["campaigns"] } }, async (req, reply) => {
    const c = await prisma.campaign.create({ data: { ...req.body, workspaceId: req.auth.workspaceId, status: "ACTIVE" } });
    return reply.status(201).send(c);
  });

  r.get("/campaigns/:id", { ...auth, schema: { params: idParam, tags: ["campaigns"] } }, async (req) => {
    await getCampaign(req.auth.workspaceId, req.params.id);
    return prisma.campaign.findFirstOrThrow({
      where: { id: req.params.id, workspaceId: req.auth.workspaceId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 20 }, _count: { select: { leads: true } } },
    });
  });

  r.patch("/campaigns/:id", { ...auth, schema: { params: idParam, body: campaignUpdateSchema, tags: ["campaigns"] } }, async (req) => {
    await getCampaign(req.auth.workspaceId, req.params.id);
    return prisma.campaign.update({ where: { id: req.params.id }, data: req.body });
  });

  r.post("/campaigns/:id/pause", { ...auth, schema: { params: idParam, tags: ["campaigns"] } }, async (req) => {
    await getCampaign(req.auth.workspaceId, req.params.id);
    return prisma.campaign.update({ where: { id: req.params.id }, data: { status: "PAUSED" } });
  });

  r.post("/campaigns/:id/resume", { ...auth, schema: { params: idParam, tags: ["campaigns"] } }, async (req) => {
    await getCampaign(req.auth.workspaceId, req.params.id);
    return prisma.campaign.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
  });

  r.post("/campaigns/:id/run", { ...auth, schema: { params: idParam, tags: ["campaigns"] } }, async (req, reply) => {
    await getCampaign(req.auth.workspaceId, req.params.id);
    const run = await startRun(req.auth.workspaceId, req.params.id, "MANUAL");
    return reply.status(202).send(run);
  });

  r.get("/campaigns/:id/runs", { ...auth, schema: { params: idParam, tags: ["campaigns"] } }, async (req) => {
    await getCampaign(req.auth.workspaceId, req.params.id);
    return prisma.campaignRun.findMany({
      where: { campaignId: req.params.id, workspaceId: req.auth.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  // ---- Runs ----
  r.get("/runs/:id", { ...auth, schema: { params: idParam, tags: ["runs"] } }, async (req) => {
    const run = await prisma.campaignRun.findFirst({
      where: { id: req.params.id, workspaceId: req.auth.workspaceId },
      include: { stages: { orderBy: { createdAt: "asc" } }, campaign: { select: { id: true, name: true } } },
    });
    if (!run) throw new HttpError(404, "Run not found");
    return run;
  });

  r.post("/runs/:id/cancel", { ...auth, schema: { params: idParam, tags: ["runs"] } }, async (req) => {
    const run = await prisma.campaignRun.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!run) throw new HttpError(404, "Run not found");
    if (!ACTIVE.includes(run.status as (typeof ACTIVE)[number])) throw new HttpError(409, `Run is ${run.status}`);
    return prisma.campaignRun.update({ where: { id: run.id }, data: { status: "CANCELLED", finishedAt: new Date() } });
  });

  r.post("/runs/:id/resume", { ...auth, schema: { params: idParam, tags: ["runs"] } }, async (req, reply) => {
    const run = await prisma.campaignRun.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!run) throw new HttpError(404, "Run not found");
    if (run.status !== "FAILED") throw new HttpError(409, "Only failed runs can be resumed");
    const other = await prisma.campaignRun.findFirst({ where: { campaignId: run.campaignId, status: { in: [...ACTIVE] } } });
    if (other) throw new HttpError(409, `Another run is active (${other.id})`);
    const updated = await prisma.campaignRun.update({ where: { id: run.id }, data: { status: "QUEUED", error: null, finishedAt: null } });
    await enqueueRun(run.id, Date.now());
    return reply.status(202).send(updated);
  });

  // ---- Scoring settings ----
  r.get("/settings/scoring", { ...auth, schema: { tags: ["settings"] } }, async (req) => loadScoring(req.auth.workspaceId));

  r.put(
    "/settings/scoring",
    {
      ...auth,
      schema: {
        body: z.object({ weights: scoringWeightsSchema, qualifyThreshold: z.number().int().min(0).max(100), autoQueueThreshold: z.number().int().min(0).max(100) }),
        tags: ["settings"],
      },
    },
    async (req) => {
      await prisma.scoringConfig.updateMany({ where: { workspaceId: req.auth.workspaceId, active: true }, data: { active: false } });
      await prisma.scoringConfig.create({ data: { workspaceId: req.auth.workspaceId, ...req.body, active: true } });
      return loadScoring(req.auth.workspaceId);
    },
  );
};
