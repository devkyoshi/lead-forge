import { z } from "zod";

export const followupStepSchema = z.object({
  /** Days after the previous email was sent. */
  delayDays: z.number().min(0).max(60),
  scenario: z.enum(["FOLLOWUP_1", "FOLLOWUP_2"]),
});
export const followupSequenceSchema = z.array(followupStepSchema).max(2);
export type FollowupStep = z.infer<typeof followupStepSchema>;

export const DEFAULT_FOLLOWUPS: FollowupStep[] = [
  { delayDays: 3, scenario: "FOLLOWUP_1" },
  { delayDays: 7, scenario: "FOLLOWUP_2" },
];

/**
 * Warm-up ramp: starts at 5 emails/day and grows 1.5x per day until it reaches the configured
 * daily limit. Day 0 is the day warm-up was enabled.
 */
export function effectiveDailyLimit(opts: { dailyLimit: number; warmupEnabled: boolean; warmupStartedAt: Date | null; now?: Date }): number {
  if (!opts.warmupEnabled || !opts.warmupStartedAt) return opts.dailyLimit;
  const days = Math.max(0, Math.floor(((opts.now ?? new Date()).getTime() - opts.warmupStartedAt.getTime()) / 86_400_000));
  return Math.min(opts.dailyLimit, Math.round(5 * 1.5 ** days));
}

/** Local calendar parts of an instant in an IANA timezone (falls back to UTC for an invalid zone). */
export function localParts(tz: string, date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(tz);
  } catch {
    parts = fmt("UTC");
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** True if `now` falls inside [startHour, endHour) in the timezone (supports windows that wrap midnight). */
export function inSendWindow(tz: string, startHour: number, endHour: number, now = new Date()): boolean {
  const h = localParts(tz, now).hour;
  return startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

/** Start of the current local day in the timezone, as a UTC instant (ignores DST shifts within the day). */
export function startOfLocalDay(tz: string, now = new Date()): Date {
  const p = localParts(tz, now);
  const elapsedMs = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

const OPT_IN_REGIONS: { pattern: RegExp; note: string }[] = [
  { pattern: /\b(uk|united kingdom|england|scotland|wales|london|manchester|birmingham)\b/i, note: "UK PECR/UK GDPR: unsolicited marketing to individuals and sole traders generally needs consent." },
  { pattern: /\b(germany|berlin|munich|hamburg|austria|vienna)\b/i, note: "Germany/Austria require prior opt-in for almost all unsolicited commercial email (UWG)." },
  { pattern: /\b(france|paris|italy|rome|milan|spain|madrid|barcelona|netherlands|amsterdam|belgium|portugal|lisbon|ireland|dublin|sweden|denmark|poland|greece|europe|eu)\b/i, note: "EU ePrivacy/GDPR: B2B rules vary by country and sole traders are often treated as consumers; opt-in may be required." },
  { pattern: /\b(canada|toronto|vancouver|montreal)\b/i, note: "Canada CASL generally requires consent (express or implied) before commercial emails." },
  { pattern: /\b(australia|sydney|melbourne|new zealand|auckland)\b/i, note: "Australia/NZ spam laws require consent (inferred consent may apply to publicly listed business addresses)." },
  { pattern: /\b(brazil|sao paulo|south africa|cape town|johannesburg|switzerland|zurich)\b/i, note: "LGPD / POPIA / Swiss UWG may require consent or a legitimate-interest assessment." },
];

/** Warnings for areas where cold email commonly requires opt-in. Informational, not legal advice. */
export function optInRegionWarnings(areaText: string): string[] {
  return OPT_IN_REGIONS.filter((r) => r.pattern.test(areaText)).map((r) => r.note);
}
