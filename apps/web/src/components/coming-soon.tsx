import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function ComingSoon({
  title,
  phase,
  description,
  hint,
  icon,
}: {
  title: string;
  phase: number;
  description: string;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-xl border border-dashed bg-card">
        <EmptyState icon={icon} title="Coming soon" hint={`This page is built in Phase ${phase}. ${hint}`} />
      </div>
    </>
  );
}
