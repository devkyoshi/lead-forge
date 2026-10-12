import type { Prisma } from "@prisma/client";
import { EMPTY_COUNTS, RUN_STAGES, type RunStage } from "@leadforge/shared";
import { prisma } from "../db.js";
import { createPlacesProvider, type PlacesProvider } from "../providers/places.js";
import { createAiProvider } from "../providers/ai.js";
import { resolveSecret } from "../lib/secrets.js";
import { auditStage, discoverStage, draftStage, enrichStage, scoreStage, type StageCtx, type StageResult } from "./stages.js";
import type { AiProvider } from "../providers/ai.js";

class RunCancelled extends Error {}

type StageFn = (ctx: StageCtx) => Promise<StageResult>;

/**
 * Executes (or resumes) a campaign run. Stages run in order; a stage already COMPLETED in
 * run_stage_logs is skipped, so a retried/resumed job continues where it stopped. Each stage
 * only touches leads that still need that stage's work, so re-running is safe.
 */
export async function executeRun(runId: string, deps: { places?: PlacesProvider; ai?: AiProvider } = {}) {
  const run = await prisma.campaignRun.findUnique({ where: { id: runId }, include: { campaign: true, stages: true } });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status === "CANCELLED" || run.status === "COMPLETED") return;

  const places = deps.places ?? createPlacesProvider(await resolveSecret(run.workspaceId, "GOOGLE_PLACES"));
  const campaign = run.campaign;
  await prisma.campaignRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date(), error: null, finishedAt: null },
  });

  const stageFns: Record<RunStage, StageFn> = {
    discover: (c) => discoverStage(c, places),
    audit: auditStage,
    enrich: enrichStage,
    score: scoreStage,
    draft: async (c) => draftStage(c, deps.ai ?? createAiProvider(await resolveSecret(c.workspaceId, "ANTHROPIC"))),
  };
  const counts: Record<string, number> = { ...EMPTY_COUNTS, ...(run.counts as Record<string, number>) };

  try {
    for (const stage of RUN_STAGES) {
      const existing = run.stages.find((s) => s.stage === stage);
      if (existing?.status === "COMPLETED") continue;

      const logs: string[] = [];
      const stageLog = await prisma.runStageLog.upsert({
        where: { runId_stage: { runId, stage } },
        create: { workspaceId: run.workspaceId, runId, stage, status: "RUNNING", startedAt: new Date() },
        update: { status: "RUNNING", startedAt: new Date(), error: null, finishedAt: null },
      });
      await prisma.campaignRun.update({ where: { id: runId }, data: { currentStage: stage } });

      const flushLogs = () =>
        prisma.runStageLog.update({ where: { id: stageLog.id }, data: { logs: logs as unknown as Prisma.InputJsonValue } });
      const ctx: StageCtx = {
        runId,
        workspaceId: run.workspaceId,
        campaign,
        log: (m) => {
          logs.push(`${new Date().toISOString()} ${m}`);
        },
        checkCancelled: async () => {
          const r = await prisma.campaignRun.findUnique({ where: { id: runId }, select: { status: true } });
          if (r?.status === "CANCELLED") throw new RunCancelled();
        },
      };

      try {
        const result = await stageFns[stage](ctx);
        for (const [k, v] of Object.entries(result.counts)) counts[k] = (counts[k] ?? 0) + v;
        await prisma.runStageLog.update({
          where: { id: stageLog.id },
          data: { status: "COMPLETED", counts: result.counts, logs: logs as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
        });
        await prisma.campaignRun.update({ where: { id: runId }, data: { counts } });
      } catch (err) {
        const message = err instanceof RunCancelled ? "Cancelled" : (err as Error).message;
        logs.push(`${new Date().toISOString()} ERROR ${message}`);
        await prisma.runStageLog.update({
          where: { id: stageLog.id },
          data: { status: err instanceof RunCancelled ? "SKIPPED" : "FAILED", error: message, logs: logs as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
        });
        throw err;
      } finally {
        await flushLogs().catch(() => {});
      }
    }
    await prisma.campaignRun.update({ where: { id: runId }, data: { status: "COMPLETED", currentStage: null, finishedAt: new Date(), counts } });
  } catch (err) {
    if (err instanceof RunCancelled) {
      await prisma.campaignRun.update({ where: { id: runId }, data: { finishedAt: new Date() } });
      return;
    }
    await prisma.campaignRun.update({ where: { id: runId }, data: { status: "FAILED", error: (err as Error).message, finishedAt: new Date() } });
    throw err; // lets BullMQ retry with backoff; the next attempt resumes at the failed stage
  }
}
