import { Kanban } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      title="Pipeline"
      phase={5}
      icon={Kanban}
      description="Track every lead from first contact to a confirmed project."
      hint="Drag and drop leads between stages, with prompts for project details or a reason when a deal is won or lost."
    />
  );
}
