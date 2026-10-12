"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { History, Users } from "lucide-react";
import { api, type Campaign, type Run } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { SchedulePicker, describeCron, browserTimezone, type Schedule } from "@/components/schedule-picker";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, humanize } from "@/components/status-badge";

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<Campaign | null>(null);
  const [schedule, setSchedule] = useState<Schedule>({ cron: null, timezone: browserTimezone() });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<Campaign>(`/campaigns/${id}`).then((x) => {
      setC(x);
      setSchedule({ cron: x.cron, timezone: x.cron ? x.timezone : browserTimezone() });
    });
  }, [id]);

  async function saveSchedule() {
    setSaving(true);
    try {
      const updated = await api<Campaign>(`/campaigns/${id}`, { method: "PATCH", json: { cron: schedule.cron, timezone: schedule.timezone } });
      setC((prev) => (prev ? { ...prev, cron: updated.cron, timezone: updated.timezone, nextRunAt: updated.nextRunAt } : prev));
      toast.success(updated.cron ? "Schedule saved" : "Schedule removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the schedule");
    } finally {
      setSaving(false);
    }
  }

  if (!c) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.area.label} · ${c.categories.join(", ")}`}
        actions={
          <>
            <StatusBadge status={c.status} />
            <Button variant="outline" nativeButton={false} render={<Link href="/leads" />}>
              <Users className="size-4" /> View leads
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Leads found", String(c._count.leads)],
          ["Approval mode", humanize(c.approvalMode)],
          ["Daily send limit", String(c.dailySendLimit)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{value}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedule</CardTitle>
          <CardDescription>
            {c.cron
              ? `${describeCron(c.cron)} (${c.timezone})${c.status === "ACTIVE" && c.nextRunAt ? `. Next run ${new Date(c.nextRunAt).toLocaleString()}` : ". Paused, so it will not run"}`
              : "Runs only when you click Run now or call the API."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SchedulePicker value={schedule} onChange={setSchedule} />
          <Button onClick={saveSchedule} disabled={saving || (schedule.cron === c.cron && (schedule.timezone === c.timezone || !schedule.cron))}>
            Save schedule
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {c.runs.length === 0 ? (
            <EmptyState icon={History} title="No runs yet" hint="Use Run now on the Campaigns page to start the first run." />
          ) : (
            <ul className="divide-y">
              {c.runs.map((r: Run) => (
                <li key={r.id}>
                  <Link href={`/runs/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm transition-colors hover:bg-muted/40">
                    <span>
                      {new Date(r.createdAt).toLocaleString()}
                      <Badge variant="outline" className="ml-2">
                        {humanize(r.trigger)}
                      </Badge>
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="text-muted-foreground tabular-nums">
                        {r.counts.new ?? 0} new · {r.counts.qualified ?? 0} qualified · {r.counts.drafted ?? 0} drafted
                      </span>
                      <StatusBadge status={r.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
