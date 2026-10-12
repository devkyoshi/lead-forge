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
import { Mail, Plus } from "lucide-react";
import { LEAD_STATUSES } from "@leadforge/shared";
import { api, type Lead } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeadSheet } from "@/components/lead-sheet";
import { AddLeadDialog } from "@/components/add-lead-dialog";

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Lead[];
}

const PAGE_SIZE = 25;

function scoreVariant(score: number): "default" | "secondary" | "outline" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "outline";
}

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
      sort: sort && ["score", "createdAt", "name", "rating"].includes(sort.id) ? sort.id : "createdAt",
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
      toast.success(`${res.created} draft(s) created. Review them in the Approval Queue.`);
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
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.address ?? "-"}</div>
          </div>
        ),
      },
      { accessorKey: "category", header: "Category", cell: ({ getValue }) => (getValue() as string) ?? "-" },
      { accessorKey: "websiteStatus", header: "Website", cell: ({ getValue }) => <Badge variant="outline">{String(getValue()).replace("_", " ")}</Badge> },
      {
        accessorKey: "rating",
        header: "Rating",
        cell: ({ row }) =>
          row.original.rating != null ? `${row.original.rating} (${row.original.reviewCount ?? 0})` : "-",
      },
      {
        accessorKey: "score",
        header: "Score",
        cell: ({ getValue }) => <Badge variant={scoreVariant(getValue() as number)}>{getValue() as number}</Badge>,
      },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <Badge variant="secondary">{String(getValue())}</Badge> },
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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!picked.size} onClick={queueEmails}>
            <Mail className="size-4" /> Queue email ({picked.size})
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add lead
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search name, address, phone..."
          className="max-w-xs"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                <TableHead className="w-8">
                  <Checkbox
                    checked={!!data?.items.length && picked.size === data.items.length}
                    onCheckedChange={(v) => setPicked(v === true && data ? new Set(data.items.map((i) => i.id)) : new Set())}
                  />
                </TableHead>
                {hg.headers.map((h) => {
                  const sortable = ["name", "rating", "score"].includes(h.column.id);
                  return (
                    <TableHead
                      key={h.id}
                      className={sortable ? "cursor-pointer select-none" : undefined}
                      onClick={sortable ? () => h.column.toggleSorting(h.column.getIsSorted() === "asc") : undefined}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" ? " ↑" : h.column.getIsSorted() === "desc" ? " ↓" : ""}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length + 1}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => setOpenId(row.original.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
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
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="h-24 text-center text-muted-foreground">
                  No leads found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{data?.total ?? 0} leads</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      <LeadSheet leadId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      <AddLeadDialog open={adding} onOpenChange={setAdding} onCreated={load} />
    </div>
  );
}
