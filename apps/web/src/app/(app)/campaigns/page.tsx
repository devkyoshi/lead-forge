"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Play, Plus } from "lucide-react";
import { api, type Campaign, type Run } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CampaignDialog } from "@/components/campaign-dialog";

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New campaign
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Categories</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!items ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No campaigns yet. Create one to start finding leads.
                </TableCell>
              </TableRow>
            ) : (
              items.map((c) => {
                const last = c.runs[0];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/campaigns/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>{c.area.label}</TableCell>
                    <TableCell className="space-x-1">
                      {c.categories.map((k) => (
                        <Badge key={k} variant="outline">
                          {k}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell>{c._count.leads}</TableCell>
                    <TableCell>
                      {last ? (
                        <Link href={`/runs/${last.id}`} className="hover:underline">
                          {last.status}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => toggle(c)}>
                        {c.status === "PAUSED" ? "Resume" : "Pause"}
                      </Button>
                      <Button size="sm" onClick={() => runNow(c.id)}>
                        <Play className="size-4" /> Run now
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <CampaignDialog open={creating} onOpenChange={setCreating} onCreated={load} />
    </div>
  );
}
