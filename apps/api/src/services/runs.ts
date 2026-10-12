import { prisma } from "../db.js";
import { enqueueRun } from "../queue.js";
import { HttpError } from "./leads.js";

export const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING"] as const;

/**
 * Creates a run and enqueues it. Refuses (409) if the campaign already has an active run, which
 * makes manual clicks, cron ticks and API triggers safe to fire at the same time.
 */
export async function startRun(workspaceId: string, campaignId: string, trigger: "MANUAL" | "CRON" | "API") {
  const active = await prisma.campaignRun.findFirst({ where: { campaignId, status: { in: [...ACTIVE_RUN_STATUSES] } } });
  if (active) throw new HttpError(409, `A run is already ${active.status.toLowerCase()} (${active.id})`);
  const run = await prisma.campaignRun.create({ data: { workspaceId, campaignId, trigger, status: "QUEUED", counts: {} } });
  await enqueueRun(run.id);
  return run;
}
