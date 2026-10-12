"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { api, type Campaign, type Run } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<Campaign | null>(null);
  useEffect(() => {
    api<Campaign>(`/campaigns/${id}`).then(setC);
  }, [id]);
  if (!c) return null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{c.name}</h1>
      <p className="text-sm text-muted-foreground">
        {c.area.label} · {c.categories.join(", ")} · {c._count.leads} leads · {c.approvalMode}
      </p>
      <Button variant="outline" render={<Link href="/leads" />}>
        View leads
      </Button>
      <h2 className="pt-2 text-lg font-medium">Run history</h2>
      <div className="space-y-2">
        {c.runs.map((r: Run) => (
          <Link
            key={r.id}
            href={`/runs/${r.id}`}
            className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted"
          >
            <span>
              {new Date(r.createdAt).toLocaleString()} · {r.trigger}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground">
                {r.counts.new ?? 0} new / {r.counts.qualified ?? 0} qualified
              </span>
              <Badge variant={r.status === "FAILED" ? "destructive" : "secondary"}>{r.status}</Badge>
            </span>
          </Link>
        ))}
        {c.runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
      </div>
    </div>
  );
}
