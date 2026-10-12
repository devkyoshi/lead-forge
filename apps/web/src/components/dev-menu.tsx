"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Bug, Check, ClipboardCopy, ExternalLink, LogIn, Moon, Send, Sun } from "lucide-react";
import { api } from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
// Demo account created by `make seed`. Only ever rendered in development builds.
const DEMO = { email: "admin@leadforge.local", password: "changeme123" };

interface Providers {
  emailProvider: string;
  aiProvider: string;
  placesProvider: string;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy to the clipboard");
  }
}

/**
 * Developer shortcuts. Rendered only when NODE_ENV is not production.
 * On the login page, pass `onFillLogin` to get a one-click "fill demo login" item.
 */
export function DevMenu({ onFillLogin }: { onFillLogin?: (email: string, password: string) => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [apiUp, setApiUp] = useState<boolean | null>(null);

  useEffect(() => {
    api<Providers>("/settings").then(setProviders).catch(() => {});
    fetch(`${API}/health`)
      .then((r) => setApiUp(r.ok))
      .catch(() => setApiUp(false));
  }, []);

  if (process.env.NODE_ENV === "production") return null;

  async function runDispatcher() {
    try {
      const r = await api<{ sent: number; failed: number; deferred: { reason: string; count: number }[] }>("/send/tick", { method: "POST" });
      toast.success(`Dispatcher: ${r.sent} sent, ${r.failed} failed`);
      r.deferred.forEach((d) => toast.info(`${d.count} waiting: ${d.reason}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispatcher failed");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
        <Bug className="size-4" /> Dev
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Environment</DropdownMenuLabel>
          <div className="space-y-0.5 px-1.5 pb-1.5 text-xs text-muted-foreground">
            <div>
              API {API.replace(/^https?:\/\//, "")}: {apiUp === null ? "checking..." : apiUp ? "up" : <span className="text-destructive">down</span>}
            </div>
            {providers && (
              <>
                <div>Email: {providers.emailProvider}{providers.emailProvider === "console" && " (nothing is really sent)"}</div>
                <div>AI: {providers.aiProvider}</div>
                <div>Places: {providers.placesProvider}</div>
              </>
            )}
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Demo login</DropdownMenuLabel>
          {onFillLogin && (
            <DropdownMenuItem onClick={() => onFillLogin(DEMO.email, DEMO.password)}>
              <LogIn className="size-4" /> Fill login form
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => copy(DEMO.email, "Email")}>
            <ClipboardCopy className="size-4" /> Copy email
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy(DEMO.password, "Password")}>
            <ClipboardCopy className="size-4" /> Copy password
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          {!onFillLogin && (
            <DropdownMenuItem onClick={runDispatcher}>
              <Send className="size-4" /> Run email dispatcher now
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} Toggle theme
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Links</DropdownMenuLabel>
          <DropdownMenuItem render={<a href={`${API}/docs`} target="_blank" rel="noreferrer" />}>
            <ExternalLink className="size-4" /> API docs (Swagger)
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href={`${API}/ready`} target="_blank" rel="noreferrer" />}>
            <Check className="size-4" /> API readiness check
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
