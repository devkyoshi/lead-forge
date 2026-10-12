import { Worker } from "bullmq";
import pino from "pino";
import "./env.js";
import { prisma } from "./db.js";
import { DEAD_LETTER_QUEUE, RUN_QUEUE, SCHEDULE_QUEUE, SEND_QUEUE, createRedis, ensureDispatcherSchedule, getDeadLetterQueue, type RunJob } from "./queue.js";
import { dispatchAll } from "./services/sender.js";
import { executeRun } from "./services/orchestrator.js";
import { startRun } from "./services/runs.js";
import { syncAllSchedules } from "./services/schedule.js";
import { HttpError } from "./services/leads.js";

const log = pino({ name: "worker" });

const worker = new Worker<RunJob>(
  RUN_QUEUE,
  async (job) => {
    log.info({ jobId: job.id, runId: job.data.runId, attempt: job.attemptsMade + 1 }, "run started");
    await executeRun(job.data.runId);
    log.info({ runId: job.data.runId }, "run finished");
  },
  { connection: createRedis(), concurrency: 2 },
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  log.error({ jobId: job.id, runId: job.data.runId, err: err.message }, "run attempt failed");
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    // Retries exhausted: park in the dead-letter queue; the run stays FAILED and can be resumed from the UI.
    await getDeadLetterQueue().add("dead-run", { runId: job.data.runId, error: err.message, jobId: job.id }, { removeOnComplete: false });
    log.error({ queue: DEAD_LETTER_QUEUE, runId: job.data.runId }, "moved to dead-letter");
  }
});

const sendWorker = new Worker(
  SEND_QUEUE,
  async () => {
    const results = await dispatchAll();
    const sent = Object.values(results).reduce((n, r) => n + r.sent, 0);
    if (sent || Object.values(results).some((r) => r.failed || r.followupsDrafted)) log.info({ results }, "dispatch tick");
  },
  { connection: createRedis(), concurrency: 1 },
);
sendWorker.on("failed", (job, err) => log.error({ jobId: job?.id, err: err.message }, "dispatch tick failed"));
await ensureDispatcherSchedule();

// Cron-triggered runs: one repeatable job per scheduled campaign.
const scheduleWorker = new Worker<{ campaignId: string; workspaceId: string }>(
  SCHEDULE_QUEUE,
  async (job) => {
    const c = await prisma.campaign.findUnique({ where: { id: job.data.campaignId } });
    if (!c || c.status !== "ACTIVE") return;
    try {
      const run = await startRun(c.workspaceId, c.id, "CRON");
      log.info({ campaignId: c.id, runId: run.id }, "scheduled run started");
    } catch (e) {
      // A run is still active from the previous tick: skip rather than stack runs.
      if (e instanceof HttpError && e.statusCode === 409) log.warn({ campaignId: c.id }, "scheduled run skipped: " + e.message);
      else throw e;
    }
  },
  { connection: createRedis(), concurrency: 1 },
);
scheduleWorker.on("failed", (job, err) => log.error({ jobId: job?.id, err: err.message }, "scheduled run failed"));
log.info({ scheduled: await syncAllSchedules() }, "campaign schedules synced");

async function shutdown() {
  await worker.close();
  await sendWorker.close();
  await scheduleWorker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
log.info("worker started");
