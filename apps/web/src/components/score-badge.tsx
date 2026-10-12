import { cn } from "@/lib/utils";

/** 0-100 lead score: green for strong leads, amber for borderline, grey otherwise. */
export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tone =
    score >= 70
      ? "bg-success-soft text-success"
      : score >= 50
        ? "bg-warning-soft text-warning"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn("inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", tone, className)}
      title={`Lead score ${score} / 100`}
    >
      {score}
    </span>
  );
}
