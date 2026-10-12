import { cn } from "@/lib/utils";

/** Card-style frame for tables: border, soft shadow, scroll on small screens, muted sticky-looking header. */
export function DataTableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border bg-card shadow-xs",
        "[&_thead_th]:h-10 [&_thead_th]:bg-muted/50 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:uppercase [&_thead_th]:tracking-wide [&_thead_th]:text-muted-foreground",
        "[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-muted/40",
        className,
      )}
    >
      {children}
    </div>
  );
}
