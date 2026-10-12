import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-brand-soft text-accent-foreground",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-destructive",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  brand: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/** One place that decides how every status in the app is coloured. */
const TONES: Record<string, Tone> = {
  // lead pipeline
  NEW: "neutral",
  QUALIFIED: "brand",
  CONTACTED: "info",
  REPLIED: "info",
  INTERESTED: "success",
  PROPOSAL_SENT: "brand",
  NEGOTIATING: "warning",
  CONFIRMED: "success",
  LOST: "danger",
  NOT_INTERESTED: "neutral",
  UNSUBSCRIBED: "danger",
  BOUNCED: "danger",
  // website audit
  NO_WEBSITE: "danger",
  SOCIAL_ONLY: "warning",
  BROKEN: "danger",
  POOR: "warning",
  OK: "success",
  UNKNOWN: "neutral",
  // campaigns, runs, drafts
  ACTIVE: "success",
  PAUSED: "warning",
  DRAFT: "neutral",
  ARCHIVED: "neutral",
  QUEUED: "info",
  RUNNING: "brand",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  PENDING: "neutral",
  SKIPPED: "neutral",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SENT: "success",
};

const LABELS: Record<string, string> = {
  NO_WEBSITE: "No website",
  SOCIAL_ONLY: "Social only",
  PENDING_REVIEW: "Pending review",
  PROPOSAL_SENT: "Proposal sent",
  NOT_INTERESTED: "Not interested",
  POOR_WEBSITE: "Poor website",
  FOLLOWUP_1: "Follow-up 1",
  FOLLOWUP_2: "Follow-up 2",
};

export function humanize(value: string): string {
  if (LABELS[value]) return LABELS[value];
  const s = value.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONES[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT_CLASS[tone])} aria-hidden />
      {humanize(status)}
    </span>
  );
}
