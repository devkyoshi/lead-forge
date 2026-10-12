"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Ban, Hand, Kanban, Search, Star } from "lucide-react";
import { LEAD_STATUSES, canTransition, type LeadStatus } from "@leadforge/shared";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadSheet } from "@/components/lead-sheet";
import { PageHeader } from "@/components/page-header";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge, humanize } from "@/components/status-badge";
import { NEEDS_DETAILS, StatusChangeDialog, type StatusExtra } from "@/components/status-change-dialog";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

interface Card {
  id: string;
  name: string;
  category: string | null;
  area: string | null;
  score: number;
  rating: number | null;
  reviewCount: number | null;
  websiteStatus: string;
  needsManualOutreach: boolean;
  checklistDone: number;
  checklistTotal: number;
}
interface Column {
  status: LeadStatus;
  count: number;
  items: Card[];
}

/** Columns the user cannot drop into: compliance statuses are only set by the system. */
const LOCKED: LeadStatus[] = ["UNSUBSCRIBED", "BOUNCED"];
const GROUPS: { title: string; hint: string; statuses: LeadStatus[] }[] = [
  { title: "Pipeline", hint: "Drag a lead to the next stage", statuses: ["NEW", "QUALIFIED", "CONTACTED", "REPLIED", "INTERESTED", "PROPOSAL_SENT", "NEGOTIATING", "CONFIRMED"] },
  { title: "Closed", hint: "Asks for a reason", statuses: ["LOST", "NOT_INTERESTED"] },
  { title: "Do not contact", hint: "Set automatically", statuses: ["UNSUBSCRIBED", "BOUNCED"] },
];

function LeadCard({ card, status, onOpen, overlay = false }: { card: Card; status: LeadStatus; onOpen?: () => void; overlay?: boolean }) {
  const locked = LOCKED.includes(status);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, data: { status }, disabled: locked || overlay });
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : { ...listeners, ...attributes })}
      onClick={onOpen}
      data-lead-id={card.id}
      className={cn(
        "group select-none rounded-lg border bg-card p-3 text-sm shadow-xs transition-shadow",
        locked ? "cursor-pointer opacity-80" : "cursor-grab active:cursor-grabbing hover:shadow-sm",
        isDragging && "opacity-30",
        overlay && "rotate-1 cursor-grabbing shadow-lg ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug">{card.name}</p>
        <ScoreBadge score={card.score} />
      </div>
      <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
        {[card.category, card.area].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={card.websiteStatus} />
        {card.rating != null && (
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            {card.rating}
          </span>
        )}
        {card.needsManualOutreach && (
          <span className="inline-flex items-center gap-1 text-xs text-warning" title="No public email: reach out by phone, WhatsApp or DM">
            <Hand className="size-3" /> Manual
          </span>
        )}
      </div>
      {card.checklistTotal > 0 && (
        <div className="mt-2.5 flex items-center gap-2" title={`${card.checklistDone} of ${card.checklistTotal} checklist items done`}>
          <div className="h-1 flex-1 rounded-full bg-muted">
            <div className="h-1 rounded-full bg-primary" style={{ width: `${(card.checklistDone / card.checklistTotal) * 100}%` }} />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {card.checklistDone}/{card.checklistTotal}
          </span>
        </div>
      )}
    </div>
  );
}

function BoardColumn({ column, dragFrom, onOpen }: { column: Column; dragFrom: LeadStatus | null; onOpen: (id: string) => void }) {
  const locked = LOCKED.includes(column.status);
  const { setNodeRef, isOver } = useDroppable({ id: column.status, disabled: locked });
  const invalid = dragFrom !== null && dragFrom !== column.status && (locked || !canTransition(dragFrom, column.status));
  return (
    <section
      ref={setNodeRef}
      aria-label={`${humanize(column.status)} column`}
      className={cn(
        "flex max-h-[calc(100vh-15rem)] w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors",
        isOver && !invalid && "border-primary/50 bg-brand-soft/60",
        invalid && "opacity-40",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <StatusBadge status={column.status} />
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{column.count}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {column.items.map((c) => (
          <LeadCard key={c.id} card={c} status={column.status} onOpen={() => onOpen(c.id)} />
        ))}
        {column.items.length === 0 && (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            {locked ? <Ban className="size-4" /> : null}
            {locked ? "None" : "Drop a lead here"}
          </div>
        )}
        {column.count > column.items.length && (
          <p className="px-1 py-1 text-center text-xs text-muted-foreground">
            Showing top {column.items.length} of {column.count}. Use the Leads page for the rest.
          </p>
        )}
      </div>
    </section>
  );
}

export default function PipelinePage() {
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [active, setActive] = useState<{ card: Card; from: LeadStatus } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ card: Card; from: LeadStatus; to: LeadStatus } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      const res = await api<{ columns: Column[] }>(`/pipeline?${params}`);
      setColumns(res.columns);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load the pipeline");
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const byStatus = useMemo(() => new Map(columns?.map((c) => [c.status, c]) ?? []), [columns]);

  function onDragStart(e: DragStartEvent) {
    const from = e.active.data.current?.status as LeadStatus | undefined;
    const card = from ? byStatus.get(from)?.items.find((c) => c.id === e.active.id) : undefined;
    if (card && from) setActive({ card, from });
  }

  /** Moves the card in the UI first, then tells the API; puts it back if the API refuses. */
  async function moveCard(card: Card, from: LeadStatus, to: LeadStatus, extra: StatusExtra = {}) {
    const before = columns;
    setColumns((cols) =>
      cols?.map((c) => {
        if (c.status === from) return { ...c, count: c.count - 1, items: c.items.filter((i) => i.id !== card.id) };
        if (c.status === to) return { ...c, count: c.count + 1, items: [card, ...c.items] };
        return c;
      }) ?? null,
    );
    try {
      await api(`/leads/${card.id}/status`, { method: "POST", json: { status: to, ...extra } });
      toast.success(`${card.name} moved to ${humanize(to)}`);
      setPendingMove(null);
      load(); // refresh counts and checklist progress that the server changed
    } catch (e) {
      setColumns(before);
      toast.error(e instanceof Error ? e.message : "Could not move the lead");
      setPendingMove(null);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const a = active;
    setActive(null);
    const to = e.over?.id as LeadStatus | undefined;
    if (!a || !to || to === a.from) return;
    if (!LEAD_STATUSES.includes(to) || !canTransition(a.from, to)) {
      toast.error(`${a.card.name} can't be moved from ${humanize(a.from)} to ${humanize(to)}`);
      return;
    }
    if (NEEDS_DETAILS.includes(to)) setPendingMove({ card: a.card, from: a.from, to });
    else moveCard(a.card, a.from, to);
  }

  const total = columns?.reduce((n, c) => n + c.count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Every lead from first contact to a confirmed project. Drag a card to change its stage; closing a deal asks for details."
      />
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by name" className="h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!columns ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      ) : total === 0 && !q ? (
        <div className="rounded-xl border border-dashed bg-card">
          <EmptyState icon={Kanban} title="No leads in the pipeline yet" hint="Run a campaign to discover leads. They appear here as New or Qualified." />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <div className="-mx-4 overflow-x-auto px-4 pb-3 md:-mx-8 md:px-8">
            <div className="flex w-max gap-6">
              {GROUPS.map((g) => (
                <div key={g.title} className="space-y-2">
                  <div className="flex items-baseline gap-2 px-1">
                    <h2 className="text-sm font-semibold">{g.title}</h2>
                    <span className="text-xs text-muted-foreground">{g.hint}</span>
                  </div>
                  <div className="flex gap-3">
                    {g.statuses.map((s) => {
                      const col = byStatus.get(s);
                      return col ? <BoardColumn key={s} column={col} dragFrom={active?.from ?? null} onOpen={setOpenId} /> : null;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DragOverlay>{active ? <LeadCard card={active.card} status={active.from} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      <StatusChangeDialog
        status={pendingMove?.to ?? null}
        leadName={pendingMove?.card.name}
        onCancel={() => setPendingMove(null)}
        onSubmit={(status, extra) => (pendingMove ? moveCard(pendingMove.card, pendingMove.from, status as LeadStatus, extra) : undefined)}
      />
      <LeadSheet leadId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </>
  );
}
