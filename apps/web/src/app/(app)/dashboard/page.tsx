"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, BarChart3, CircleDollarSign, ClipboardCheck, MessageSquareReply, Table2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, humanize } from "@/components/status-badge";
import { cn } from "@/lib/utils";

interface Summary {
  funnel: { key: string; label: string; count: number }[];
  kpis: { totalLeads: number; replyRate: number; confirmedValue: number; pendingReview: number };
  send: { sentToday: number; dailyCap: number; sentLastHour: number; hourlyLimit: number; inSendWindow: boolean; approvedWaiting: number };
  emailsPerDay: { date: string; count: number }[];
  runs: { id: string; status: string; trigger: string; createdAt: string; counts: Record<string, number>; campaign: { id: string; name: string } }[];
  topTemplates: { id: string; name: string; scenario: string; sent: number; opened: number; replied: number; converted: number }[];
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
const money = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Kpi({ icon: Icon, label, value, hint, href }: { icon: typeof Users; label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <Card className={cn("h-full", href && "transition-colors hover:border-primary/40")}>
      <CardContent className="flex items-start gap-3 py-1">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary">
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Horizontal bars, one hue. Length is the magnitude; each stage also shows its conversion from the previous one. */
function Funnel({ stages }: { stages: Summary["funnel"] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <ul className="space-y-3" aria-label="Lead funnel">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1]!.count : null;
        return (
          <li key={s.key}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums">
                <strong>{s.count}</strong>
                {prev !== null && <span className="ml-2 text-xs text-muted-foreground">{pct(s.count, prev)} of {stages[i - 1]!.label.toLowerCase()}</span>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted">
              <div className="h-2.5 rounded-full bg-[var(--chart-1)] transition-all" style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count ? 6 : 0 }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Daily totals as thin bars with rounded tops, hover tooltip, and a table fallback. */
function DailyBars({ data }: { data: Summary["emailsPerDay"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((n, d) => n + d.count, 0);
  const W = 560;
  const H = 150;
  const slot = W / data.length;
  const barW = Math.min(18, slot - 8);
  const ticks = [0, Math.ceil(max / 2), max];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{total} emails in the last {data.length} days</p>
        <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />} {asTable ? "Chart" : "Table"}
        </Button>
      </div>
      {asTable ? (
        <div className="max-h-48 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Emails sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.date}>
                  <TableCell>{dayLabel(d.date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 -8 ${W} ${H + 30}`} className="w-full" role="img" aria-label={`Emails sent per day, ${total} in total over ${data.length} days`}>
            {ticks.map((t) => {
              const y = H - (t / max) * H;
              return (
                <g key={t}>
                  <line x1={28} x2={W} y1={y} y2={y} className="stroke-border" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "3 4"} />
                  <text x={22} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{t}</text>
                </g>
              );
            })}
            {data.map((d, i) => {
              const h = Math.max(d.count ? 3 : 0, (d.count / max) * (H - 4));
              const x = 28 + (i + 0.5) * ((W - 28) / data.length) - barW / 2;
              const y = H - h;
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* wide transparent hit target so thin bars are easy to hover */}
                  <rect x={x - 6} y={0} width={barW + 12} height={H + 20} fill="transparent" />
                  {d.count > 0 && <path d={`M${x},${H} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + barW - 4} Q${x + barW},${y} ${x + barW},${y + 4} V${H} Z`} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.45} />}
                  {(i % 2 === 0 || data.length < 8) && (
                    <text x={x + barW / 2} y={H + 15} textAnchor="middle" className="fill-muted-foreground text-[9.5px]">{dayLabel(d.date)}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${((28 + (hover + 0.5) * ((W - 28) / data.length)) / W) * 100}%` }}
            >
              <p className="font-medium">{dayLabel(data[hover]!.date)}</p>
              <p className="tabular-nums text-muted-foreground">{data[hover]!.count} sent</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    api<Summary>("/dashboard/summary")
      .then(setS)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load the dashboard"));
  }, []);

  if (!s) {
    return (
      <>
        <PageHeader title="Dashboard" description="Your outreach at a glance." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </>
    );
  }

  const usedPct = s.send.dailyCap ? Math.min(100, (s.send.sentToday / s.send.dailyCap) * 100) : 0;
  const empty = s.kpis.totalLeads === 0;

  return (
    <>
      <PageHeader title="Dashboard" description="Your outreach at a glance: how many leads reach each stage, what you sent today, and which templates work." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Users} label="Total leads" value={String(s.kpis.totalLeads)} href="/leads" />
        <Kpi icon={MessageSquareReply} label="Reply rate" value={pct(Math.round(s.kpis.replyRate * 1000), 1000)} hint="of contacted leads" />
        <Kpi icon={CircleDollarSign} label="Confirmed value" value={money(s.kpis.confirmedValue)} hint="from won projects" />
        <Kpi icon={ClipboardCheck} label="Awaiting review" value={String(s.kpis.pendingReview)} hint="drafts to approve" href="/approvals" />
      </div>

      {empty ? (
        <div className="rounded-xl border border-dashed bg-card">
          <EmptyState
            icon={BarChart3}
            title="Nothing to show yet"
            hint="Create a campaign and run it. The funnel, send volume and template results fill in as leads and emails come through."
            action={
              <Button nativeButton={false} render={<Link href="/campaigns" />}>
                Go to campaigns <ArrowRight className="size-4" />
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lead funnel</CardTitle>
              <CardDescription>Leads that reached each stage (or any later one).</CardDescription>
            </CardHeader>
            <CardContent>
              <Funnel stages={s.funnel} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Emails sent</CardTitle>
              <CardDescription>
                Today: <strong className="text-foreground">{s.send.sentToday}</strong> of {s.send.dailyCap} · this hour {s.send.sentLastHour} of {s.send.hourlyLimit}
                {!s.send.inSendWindow && <span className="ml-2 text-warning">outside send window</span>}
              </CardDescription>
              <div className="h-1.5 rounded-full bg-muted" role="progressbar" aria-valuenow={s.send.sentToday} aria-valuemax={s.send.dailyCap} aria-label="Emails sent today against the daily limit">
                <div className={cn("h-1.5 rounded-full transition-all", usedPct >= 100 ? "bg-warning" : "bg-primary")} style={{ width: `${usedPct}%` }} />
              </div>
            </CardHeader>
            <CardContent>
              <DailyBars data={s.emailsPerDay} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
              <CardDescription>Latest campaign runs.</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/campaigns" />}>
                  All campaigns
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              {s.runs.length === 0 ? (
                <EmptyState title="No runs yet" hint="Run a campaign to see it here." />
              ) : (
                <ul className="divide-y">
                  {s.runs.map((r) => (
                    <li key={r.id}>
                      <Link href={`/runs/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 transition-colors hover:bg-muted/40">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.campaign.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleString()} · {humanize(r.trigger)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {r.counts.new ?? 0} new · {r.counts.qualified ?? 0} qualified
                          </span>
                          <StatusBadge status={r.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top templates</CardTitle>
              <CardDescription>Ranked by replies, then volume.</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/templates" />}>
                  All templates
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="[&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Template</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Opened</TableHead>
                    <TableHead className="text-right">Replied</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.topTemplates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-48 truncate font-medium">{t.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.sent}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(t.opened, t.sent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(t.replied, t.sent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.converted}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
