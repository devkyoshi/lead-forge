"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Pause, Play, Plus } from "lucide-react";
import { api, type Campaign, type Run } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CampaignDialog } from "@/components/campaign-dialog";
import { DataTableShell } from "@/components/data-table-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { describeCron } from "@/components/schedule-picker";

export default function CampaignsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Campaign[] }>("/campaigns")).items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load campaigns");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function runNow(id: string) {
    try {
      const run = await api<Run>(`/campaigns/${id}/run`, { method: "POST" });
      toast.success("Run started");
      router.push(`/runs/${run.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start run");
    }
  }

  async function toggle(c: Campaign) {
    await api(`/campaigns/${c.id}/${c.status === "PAUSED" ? "resume" : "pause"}`, { method: "POST" });
    load();
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="A campaign defines where to look, which kinds of business, and how to reach them. Run it to discover, audit and score new leads."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New campaign
          </Button>
        }
      />
      <DataTableShell>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Campaign</TableHead>
              <TableHead>Categories</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!items ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7}>
                  <EmptyState
                    icon={Megaphone}
                    title="No campaigns yet"
                    hint="Create a campaign for an area and a few categories, then click Run now to find your first leads."
                    action={
                      <Button onClick={() => setCreating(true)}>
                        <Plus className="size-4" /> New campaign
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              items.map((c) => {
                const last = c.runs[0];
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-primary hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{c.area.label}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.categories.map((k) => (
                          <Badge key={k} variant="outline" className="capitalize">
                            {k}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c._count.leads}</TableCell>
                    <TableCell className="text-sm">
                      <div>{describeCron(c.cron)}</div>
                      {c.cron && c.status === "ACTIVE" && c.nextRunAt && (
                        <div className="text-xs text-muted-foreground">Next: {new Date(c.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</div>
                      )}
                      {c.cron && c.status !== "ACTIVE" && <div className="text-xs text-muted-foreground">Paused</div>}
                    </TableCell>
                    <TableCell>
                      {last ? (
                        <Link href={`/runs/${last.id}`} aria-label="Open last run">
                          <StatusBadge status={last.status} />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Never run</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => toggle(c)}>
                          {c.status === "PAUSED" ? (
                            <>
                              <Play className="size-3.5" /> Resume
                            </>
                          ) : (
                            <>
                              <Pause className="size-3.5" /> Pause
                            </>
                          )}
                        </Button>
                        <Button size="sm" onClick={() => runNow(c.id)}>
                          <Play className="size-3.5" /> Run now
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DataTableShell>
      <CampaignDialog open={creating} onOpenChange={setCreating} onSaved={load} />
    </>
  );
}
