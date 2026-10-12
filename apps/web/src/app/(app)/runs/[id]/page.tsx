"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Circle, Loader2, MinusCircle, Users } from "lucide-react";
import { api, type Run } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

const STAGES: { key: string; title: string; hint: string }[] = [
  { key: "discover", title: "Discover", hint: "Search the area and remove duplicates" },
  { key: "audit", title: "Audit websites", hint: "Check each site for problems" },
  { key: "enrich", title: "Find contacts", hint: "Look for public email addresses" },
  { key: "score", title: "Score leads", hint: "Rank how good a prospect each is" },
  { key: "draft", title: "Draft emails", hint: "Personalise a proposal for top leads" },
];
const COUNT_LABELS: [string, string][] = [
  ["discovered", "Discovered"],
  ["new", "New leads"],
  ["duplicates", "Duplicates"],
  ["audited", "Audited"],
  ["qualified", "Qualified"],
  ["drafted", "Drafted"],
  ["sent", "Sent"],
  ["failed", "Failed"],
];

function StageIcon({ status }: { status?: string }) {
  switch (status) {
    case "COMPLETED":
      return <CheckCircle2 className="size-5 text-success" />;
    case "RUNNING":
      return <Loader2 className="size-5 animate-spin text-primary" />;
    case "FAILED":
      return <AlertCircle className="size-5 text-destructive" />;
    case "SKIPPED":
      return <MinusCircle className="size-5 text-muted-foreground" />;
    default:
      return <Circle className="size-5 text-muted-foreground/50" />;
  }
}

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

  if (!run) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  async function act(path: string) {
    try {
      await api(`/runs/${id}/${path}`, { method: "POST" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  return (
    <>
      <PageHeader
        title={`Run: ${run.campaign?.name ?? ""}`}
        description={`${new Date(run.createdAt).toLocaleString()} · started by ${run.trigger.toLowerCase()}`}
        actions={
          <>
            <StatusBadge status={run.status} />
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
              <Users className="size-4" /> View leads
            </Button>
          </>
        }
      />
      {run.error && <p className="rounded-lg border border-destructive/30 bg-danger-soft px-4 py-3 text-sm text-destructive">{run.error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {COUNT_LABELS.map(([k, label]) => (
          <Card key={k} size="sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{run.counts[k] ?? 0}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            {STAGES.map((s, i) => {
              const log = run.stages?.find((x) => x.stage === s.key);
              return (
                <li key={s.key} className="relative flex gap-4">
                  {i < STAGES.length - 1 && <span className="absolute left-2.5 top-7 h-[calc(100%+0.75rem)] w-px bg-border" aria-hidden />}
                  <span className="relative z-10 mt-0.5 bg-card">
                    <StageIcon status={log?.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{s.title}</p>
                      <StatusBadge status={log?.status ?? "PENDING"} />
                    </div>
                    <p className="text-sm text-muted-foreground">{s.hint}</p>
                    {log && log.logs.length > 0 && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-3 font-mono text-xs text-muted-foreground">
                        {log.logs.join("\n")}
                      </pre>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
