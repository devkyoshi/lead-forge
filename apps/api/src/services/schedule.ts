import { CronExpressionParser } from "cron-parser";
import type { Campaign } from "@prisma/client";
import { prisma } from "../db.js";
import { getScheduleQueue } from "../queue.js";
import { HttpError } from "./leads.js";

/** Smallest allowed gap between scheduled runs; protects places-API quota and inboxes from a typo like `* * * * *`. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

const schedulerId = (campaignId: string) => `campaign-${campaignId}`;

/** Throws a 400 for an invalid cron expression, timezone, or one that fires too often. */
export function assertValidCron(expr: string, tz: string) {
  let a: number;
  let b: number;
  try {
    // The library validates the timezone lazily, so the first lookups must be inside the try.
    const it = CronExpressionParser.parse(expr, { tz });
    a = it.next().toDate().getTime();
    b = it.next().toDate().getTime();
  } catch {
    throw new HttpError(400, "Invalid schedule: use a cron expression like 0 9 * * 1-5 and a valid timezone");
  }
  if (b - a < MIN_INTERVAL_MS) throw new HttpError(400, "Scheduled runs must be at least one hour apart");
}

export function nextRunAt(expr: string | null | undefined, tz: string, from = new Date()): Date | null {
  if (!expr) return null;
  try {
    return CronExpressionParser.parse(expr, { tz, currentDate: from }).next().toDate();
  } catch {
    return null;
  }
}

/** A campaign is scheduled only while it is ACTIVE and has a cron expression. */
export async function syncCampaignSchedule(c: Pick<Campaign, "id" | "workspaceId" | "status" | "cron" | "timezone">) {
  const q = getScheduleQueue();
  if (c.status === "ACTIVE" && c.cron) {
    await q.upsertJobScheduler(
      schedulerId(c.id),
      { pattern: c.cron, tz: c.timezone },
      { name: "scheduled-run", data: { campaignId: c.id, workspaceId: c.workspaceId }, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
  } else {
    await q.removeJobScheduler(schedulerId(c.id));
  }
}

/** Reconciles Redis with the database (run at worker start, so schedules survive a Redis flush). */
export async function syncAllSchedules() {
  const campaigns = await prisma.campaign.findMany({ select: { id: true, workspaceId: true, status: true, cron: true, timezone: true } });
  let scheduled = 0;
  for (const c of campaigns) {
    try {
      await syncCampaignSchedule(c);
      if (c.status === "ACTIVE" && c.cron) scheduled++;
    } catch (e) {
      console.error(`could not sync schedule for campaign ${c.id}:`, (e as Error).message);
    }
  }
  return scheduled;
}
