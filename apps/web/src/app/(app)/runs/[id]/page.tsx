"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Run } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STAGES = ["discover", "audit", "enrich", "score"];
const COUNT_LABELS: [string, string][] = [
  ["discovered", "Discovered"],
  ["new", "New"],
  ["duplicates", "Duplicates"],
  ["audited", "Audited"],
  ["qualified", "Qualified"],
  ["drafted", "Drafted"],
  ["sent", "Sent"],
  ["failed", "Failed"],
];

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<Run | null>(null);

  const load = useCallback(async () => {
    try {
      setRun(await api<Run>(`/runs/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load run");
    }
  }, [id]);

  const active = run?.status === "QUEUED" || run?.status === "RUNNING";

  useEffect(() => {
    load();
  }, [load]);
  // Poll while the run is in progress.
  useEffect(() => {
    if (run && !active) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load, active, run]);

  if (!run) return null;

  async function act(path: string) {
    try {
      await api(`/runs/${id}/${path}`, { method: "POST" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Run: {run.campaign?.name}</h1>
          <p className="text-sm text-muted-foreground">
            {run.trigger} · {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={run.status === "FAILED" ? "destructive" : "secondary"}>{run.status}</Badge>
          {active && (
            <Button variant="outline" size="sm" onClick={() => act("cancel")}>
              Cancel
            </Button>
          )}
          {run.status === "FAILED" && (
            <Button size="sm" onClick={() => act("resume")}>
              Resume
            </Button>
          )}
          <Button size="sm" variant="outline" render={<Link href="/leads" />}>
            View leads
          </Button>
        </div>
      </div>
      {run.error && <p className="text-sm text-destructive">{run.error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {COUNT_LABELS.map(([k, label]) => (
          <Card key={k}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{run.counts[k] ?? 0}</CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        {STAGES.map((s) => {
          const log = run.stages?.find((x) => x.stage === s);
          return (
            <Card key={s}>
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-base capitalize">{s}</CardTitle>
                <Badge
                  variant={log?.status === "FAILED" ? "destructive" : log?.status === "COMPLETED" ? "default" : "outline"}
                >
                  {log?.status ?? "PENDING"}
                </Badge>
              </CardHeader>
              {log && log.logs.length > 0 && (
                <CardContent>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {log.logs.join("\n")}
                  </pre>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
