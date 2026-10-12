import { describe, expect, it } from "vitest";
import { assertValidCron, nextRunAt } from "./schedule";

describe("assertValidCron", () => {
  it("accepts normal schedules", () => {
    expect(() => assertValidCron("0 9 * * 1-5", "Asia/Kolkata")).not.toThrow();
    expect(() => assertValidCron("30 6 * * *", "UTC")).not.toThrow();
  });

  it("rejects schedules that fire more often than hourly", () => {
    expect(() => assertValidCron("* * * * *", "UTC")).toThrow(/one hour apart/);
    expect(() => assertValidCron("*/15 * * * *", "UTC")).toThrow(/one hour apart/);
  });

  it("rejects garbage expressions and unknown timezones with a clear message", () => {
    expect(() => assertValidCron("not a cron", "UTC")).toThrow(/Invalid schedule/);
    expect(() => assertValidCron("0 9 * * *", "Mars/Base")).toThrow(/Invalid schedule/);
  });
});

describe("nextRunAt", () => {
  it("computes the next fire time in the campaign timezone", () => {
    // 09:00 in Asia/Kolkata (UTC+5:30) is 03:30 UTC.
    const next = nextRunAt("0 9 * * *", "Asia/Kolkata", new Date("2026-06-01T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-06-01T03:30:00.000Z");
  });

  it("returns null when there is no schedule or it is invalid", () => {
    expect(nextRunAt(null, "UTC")).toBeNull();
    expect(nextRunAt("garbage", "UTC")).toBeNull();
  });
});
