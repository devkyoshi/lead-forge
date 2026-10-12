import { LayoutDashboard } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      title="Dashboard"
      phase={5}
      icon={LayoutDashboard}
      description="Your outreach at a glance."
      hint="It will show the funnel from discovered to confirmed, emails sent today against your limit, run history and top templates."
    />
  );
}
