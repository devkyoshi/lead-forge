"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Mail, Plus, Search, Star, Users, X } from "lucide-react";
import { LEAD_STATUSES } from "@leadforge/shared";
import { api, type Lead } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeadSheet } from "@/components/lead-sheet";
import { AddLeadDialog } from "@/components/add-lead-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, humanize } from "@/components/status-badge";
import { ScoreBadge } from "@/components/score-badge";
import { EmptyState } from "@/components/empty-state";
import { DataTableShell } from "@/components/data-table-shell";

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Lead[];
}

const PAGE_SIZE = 25;
const SORTABLE = ["name", "rating", "score", "createdAt"];

export default function LeadsPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const sort = sorting[0];
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: sort && SORTABLE.includes(sort.id) ? sort.id : "createdAt",
      dir: sort?.desc === false ? "asc" : "desc",
    });
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    try {
      setData(await api<ListResponse>(`/leads?${params}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [page, q, status, sorting]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function queueEmails() {
    try {
      const res = await api<{ created: number; skipped: { name: string; reason: string }[] }>("/leads/queue-email", {
        method: "POST",
        json: { ids: [...picked] },
      });
      toast.success(`${res.created} draft(s) created. Review them in the Approval queue.`);
      res.skipped.slice(0, 5).forEach((s) => toast.warning(`${s.name}: ${s.reason}`));
      setPicked(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue emails");
    }
  }

  const columns = useMemo<ColumnDef<Lead>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Business",
        cell: ({ row }) => (
          <div className="min-w-48">
            <div className="font-medium">{row.original.name}</div>
            <div className="max-w-xs truncate text-xs text-muted-foreground">{row.original.address ?? "No address"}</div>
          </div>
        ),
      },
      { accessorKey: "category", header: "Category", cell: ({ getValue }) => <span className="capitalize">{(getValue() as string) ?? "-"}</span> },
      { accessorKey: "websiteStatus", header: "Website", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
      {
        accessorKey: "rating",
        header: "Rating",
        cell: ({ row }) =>
          row.original.rating != null ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              {row.original.rating}
              <span className="text-xs text-muted-foreground">({row.original.reviewCount ?? 0})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      { accessorKey: "score", header: "Score", cell: ({ getValue }) => <ScoreBadge score={getValue() as number} /> },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    ],
    [],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    state: { sorting },
    onSortingChange: (s) => {
      setSorting(s);
      setPage(1);
    },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);
  const colSpan = columns.length + 1;
  const filtered = !!q || status !== "all";

  return (
    <>
      <PageHeader
        title="Leads"
        description="Businesses found by your campaigns, with website audit results and a score for how good a prospect each one is."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add lead
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, address or phone"
            className="h-9 pl-8"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-48">
            <SelectValue placeholder="Status">{status === "all" ? "All statuses" : humanize(status)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {humanize(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setStatus("all");
              setPage(1);
            }}
          >
            <X className="size-4" /> Clear filters
          </Button>
        )}
        {picked.size > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-lg border bg-brand-soft px-3 py-1.5 text-sm">
            <span className="font-medium text-accent-foreground">{picked.size} selected</span>
            <Button size="sm" onClick={queueEmails}>
              <Mail className="size-4" /> Queue email
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <DataTableShell>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={!!data?.items.length && picked.size === data.items.length}
                    onCheckedChange={(v) => setPicked(v === true && data ? new Set(data.items.map((i) => i.id)) : new Set())}
                  />
                </TableHead>
                {hg.headers.map((h) => {
                  const sortable = SORTABLE.includes(h.column.id);
                  const dir = h.column.getIsSorted();
                  return (
                    <TableHead
                      key={h.id}
                      className={sortable ? "cursor-pointer select-none" : undefined}
                      onClick={sortable ? () => h.column.toggleSorting(dir === "asc") : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" && <ArrowUp className="size-3" />}
                        {dir === "desc" && <ArrowDown className="size-3" />}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={colSpan}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" data-state={picked.has(row.original.id) ? "selected" : undefined} onClick={() => setOpenId(row.original.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${row.original.name}`}
                      checked={picked.has(row.original.id)}
                      onCheckedChange={(v) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (v === true) n.add(row.original.id);
                          else n.delete(row.original.id);
                          return n;
                        })
                      }
                    />
                  </TableCell>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colSpan}>
                  <EmptyState
                    icon={Users}
                    title={filtered ? "No leads match these filters" : "No leads yet"}
                    hint={filtered ? "Try a different search or clear the filters." : "Run a campaign to discover local businesses, or add a lead by hand."}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DataTableShell>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total ? `Showing ${from}-${to} of ${total}` : "0 leads"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <LeadSheet leadId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      <AddLeadDialog open={adding} onOpenChange={setAdding} onCreated={load} />
    </>
  );
}
