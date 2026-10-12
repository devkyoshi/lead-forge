"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface Schedule {
  cron: string | null;
  timezone: string;
}

type Mode = "none" | "daily" | "weekdays" | "weekly" | "custom";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Parts {
  mode: Mode;
  time: string;
  dow: number;
  custom: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function buildCron(p: Parts): string | null {
  const [h, m] = p.time.split(":").map(Number);
  const hh = Number.isFinite(h) ? h : 9;
  const mm = Number.isFinite(m) ? m : 0;
  switch (p.mode) {
    case "none":
      return null;
    case "daily":
      return `${mm} ${hh} * * *`;
    case "weekdays":
      return `${mm} ${hh} * * 1-5`;
    case "weekly":
      return `${mm} ${hh} * * ${p.dow}`;
    case "custom":
      return p.custom.trim() || null;
  }
}

/** Recognises the presets this picker produces; anything else is shown as a custom expression. */
export function parseCron(cron: string | null | undefined): Parts {
  const base: Parts = { mode: "none", time: "09:00", dow: 1, custom: "" };
  if (!cron) return base;
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(cron.trim());
  if (m) {
    const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`;
    if (m[3] === "*") return { ...base, mode: "daily", time };
    if (m[3] === "1-5") return { ...base, mode: "weekdays", time };
    return { ...base, mode: "weekly", time, dow: Number(m[3]) };
  }
  return { ...base, mode: "custom", custom: cron };
}

export function describeCron(cron: string | null | undefined): string {
  const p = parseCron(cron);
  switch (p.mode) {
    case "none":
      return "Manual only";
    case "daily":
      return `Daily at ${p.time}`;
    case "weekdays":
      return `Weekdays at ${p.time}`;
    case "weekly":
      return `${DAYS[p.dow]}s at ${p.time}`;
    default:
      return `Cron ${cron}`;
  }
}

export const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** Run-schedule editor: presets for the common cases, a cron box for everything else. */
export function SchedulePicker({ value, onChange }: { value: Schedule; onChange: (v: Schedule) => void }) {
  const [parts, setParts] = useState<Parts>(() => parseCron(value.cron));

  // Re-sync when the parent loads a different campaign.
  useEffect(() => {
    setParts(parseCron(value.cron));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.cron === null]);

  function update(next: Partial<Parts>) {
    const merged = { ...parts, ...next };
    setParts(merged);
    onChange({ cron: buildCron(merged), timezone: value.timezone });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sched-mode">Run automatically</Label>
          <select
            id="sched-mode"
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={parts.mode}
            onChange={(e) => update({ mode: e.target.value as Mode })}
          >
            <option value="none">Never (manual runs only)</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Once a week</option>
            <option value="custom">Custom cron expression</option>
          </select>
        </div>
        {parts.mode !== "none" && parts.mode !== "custom" && (
          <div className="space-y-1">
            <Label htmlFor="sched-time">At</Label>
            <Input id="sched-time" type="time" value={parts.time} onChange={(e) => update({ time: e.target.value })} className="h-9" />
          </div>
        )}
      </div>
      {parts.mode === "weekly" && (
        <div className="space-y-1">
          <Label htmlFor="sched-dow">On</Label>
          <select
            id="sched-dow"
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={parts.dow}
            onChange={(e) => update({ dow: Number(e.target.value) })}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
      {parts.mode === "custom" && (
        <div className="space-y-1">
          <Label htmlFor="sched-cron">Cron expression</Label>
          <Input id="sched-cron" value={parts.custom} onChange={(e) => update({ custom: e.target.value })} placeholder="0 9 * * 1-5" className="h-9 font-mono" />
          <p className="text-xs text-muted-foreground">Five fields: minute hour day-of-month month day-of-week. Runs must be at least an hour apart.</p>
        </div>
      )}
      {parts.mode !== "none" && (
        <div className="space-y-1">
          <Label htmlFor="sched-tz">Timezone</Label>
          <Input
            id="sched-tz"
            value={value.timezone}
            onChange={(e) => onChange({ cron: value.cron, timezone: e.target.value })}
            placeholder="Asia/Kolkata"
            className="h-9"
          />
        </div>
      )}
    </div>
  );
}
