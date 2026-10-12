import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";

/** BullMQ requires maxRetriesPerRequest: null on worker connections. */
export function createRedis() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export const RUN_QUEUE = "campaign-runs";
export const DEAD_LETTER_QUEUE = "dead-letter";

let runQueue: Queue | null = null;
let deadLetterQueue: Queue | null = null;

export function getRunQueue() {
  runQueue ??= new Queue(RUN_QUEUE, { connection: createRedis() });
  return runQueue;
}
export function getDeadLetterQueue() {
  deadLetterQueue ??= new Queue(DEAD_LETTER_QUEUE, { connection: createRedis() });
  return deadLetterQueue;
}

export interface RunJob {
  runId: string;
}

/** jobId makes enqueueing idempotent: the same run attempt can never be queued twice. */
export async function enqueueRun(runId: string, attempt = 0) {
  return getRunQueue().add(
    "run",
    { runId } satisfies RunJob,
    {
      jobId: `run-${runId}-${attempt}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: false,
    },
  );
}
