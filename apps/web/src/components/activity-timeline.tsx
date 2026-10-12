"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, FilePen, Globe, Mail, MailOpen, MessageSquareReply, Sparkles, StickyNote, UserPlus, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

interface Entry {
  at: string;
  kind: "created" | "status" | "audit" | "email_sent" | "email_event" | "reply" | "note" | "draft";
  title: string;
  detail?: string;
  actor?: string;
}

const ICONS: Record<Entry["kind"], { icon: LucideIcon; tone: string }> = {
  created: { icon: UserPlus, tone: "bg-muted text-muted-foreground" },
  status: { icon: ArrowRightLeft, tone: "bg-brand-soft text-primary" },
  audit: { icon: Globe, tone: "bg-info-soft text-info" },
  draft: { icon: FilePen, tone: "bg-muted text-muted-foreground" },
  email_sent: { icon: Mail, tone: "bg-info-soft text-info" },
  email_event: { icon: MailOpen, tone: "bg-success-soft text-success" },
  reply: { icon: MessageSquareReply, tone: "bg-success-soft text-success" },
  note: { icon: StickyNote, tone: "bg-warning-soft text-warning" },
};

/** Unified activity feed for a lead: who or what did it, when, and old → new for status changes. */
export function ActivityTimeline({ leadId, refreshKey }: { leadId: string; refreshKey?: number }) {
  const [items, setItems] = useState<Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: Entry[] }>(`/leads/${leadId}/timeline`)
      .then((r) => !cancelled && setItems(r.items))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [leadId, refreshKey]);

  if (!items) return <Skeleton className="h-32 w-full" />;
  if (!items.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;

  return (
    <ol className="space-y-4">
      {items.map((e, i) => {
        const { icon: Icon, tone } = ICONS[e.kind] ?? { icon: Sparkles, tone: "bg-muted text-muted-foreground" };
        return (
          <li key={`${e.at}-${i}`} className="relative flex gap-3">
            {i < items.length - 1 && <span className="absolute left-3.5 top-8 h-[calc(100%-0.5rem)] w-px bg-border" aria-hidden />}
            <span className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ${tone}`}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <p className="text-sm font-medium">{e.title}</p>
              {e.detail && <p className="mt-0.5 line-clamp-3 text-sm text-muted-foreground">{e.detail}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Date(e.at).toLocaleString()}
                {e.actor ? ` · ${e.actor}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
