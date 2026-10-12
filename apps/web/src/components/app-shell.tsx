"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Check,
  CheckSquare,
  ChevronsUpDown,
  FileText,
  Kanban,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Monitor,
  Moon,
  Radar,
  Settings,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api, type Me } from "@/lib/api";
import { DevMenu } from "@/components/dev-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "approvals";
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Prospecting",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/leads", label: "Leads", icon: Users },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
    ],
  },
  {
    label: "Outreach",
    items: [
      { href: "/templates", label: "Templates", icon: FileText },
      { href: "/approvals", label: "Approval queue", icon: CheckSquare, badge: "approvals" },
    ],
  },
  { label: "Workspace", items: [{ href: "/settings", label: "Settings", icon: Settings }] },
];

/** Page title shown in the top bar, as "Group / Page". Falls back to the first path segment. */
function crumbsFor(pathname: string): string[] {
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      if (pathname.startsWith(item.href)) {
        const rest = pathname.slice(item.href.length).split("/").filter(Boolean);
        return [g.label, item.label, ...(rest.length ? [item.href === "/campaigns" ? "Campaign" : "Details"] : [])];
      }
    }
  }
  if (pathname.startsWith("/runs")) return ["Prospecting", "Campaigns", "Run"];
  return ["LeadForge"];
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "U";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    api<Me>("/auth/me")
      .then(setMe)
      .catch(() => router.replace("/login"));
  }, [router]);

  // Keep the approval badge fresh as the user moves around.
  useEffect(() => {
    if (!me) return;
    api<{ items: unknown[] }>("/drafts?status=PENDING_REVIEW")
      .then((r) => setPending(r.items.length))
      .catch(() => {});
  }, [me, pathname]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  if (!me) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 shrink-0 space-y-3 border-r p-4 md:block">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  const crumbs = crumbsFor(pathname);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Radar className="size-4.5" />
            </div>
            <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold tracking-tight">LeadForge</p>
              <p className="truncate text-xs text-muted-foreground">Lead generation</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-wider">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map(({ href, label, icon: Icon, badge }) => {
                    const active = pathname.startsWith(href);
                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          render={<Link href={href} />}
                          isActive={active}
                          tooltip={label}
                          className="data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground"
                        >
                          <Icon className={active ? "text-primary" : undefined} />
                          <span>{label}</span>
                        </SidebarMenuButton>
                        {badge === "approvals" && pending > 0 && (
                          <SidebarMenuBadge className="rounded-full bg-primary text-primary-foreground">{pending}</SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-brand-soft text-xs font-semibold text-accent-foreground">
                      {initials(me.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{me.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{me.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-60">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Signed in as {me.email}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
                    {(
                      [
                        ["light", "Light", Sun],
                        ["dark", "Dark", Moon],
                        ["system", "System", Monitor],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
                        <Icon className="size-4" /> {label}
                        {theme === value && <Check className="ml-auto size-4 text-primary" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout}>
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5" />
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
            {crumbs.map((c, i) => (
              <span key={`${c}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground/60">/</span>}
                <span className={i === crumbs.length - 1 ? "truncate font-medium" : "truncate text-muted-foreground"}>{c}</span>
              </span>
            ))}
          </nav>
          <div className="ml-auto">
            <DevMenu />
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
