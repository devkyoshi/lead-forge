"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { DEFAULT_CHECKLIST } from "@leadforge/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface Workspace {
  name: string;
  senderName: string | null;
  senderCompany: string | null;
  senderAddress: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  portfolioLink: string | null;
  timezone: string;
  sendWindowStart: number;
  sendWindowEnd: number;
  dailyLimit: number;
  hourlyLimit: number;
  warmupEnabled: boolean;
  jurisdictionNotes: string | null;
  eventWebhookUrl: string;
  inboundWebhookUrl: string;
  emailProvider: string;
  aiProvider: string;
  placesProvider: string;
}

const saveError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed");

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SenderAndSending() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const load = useCallback(() => api<Workspace>("/settings").then(setWs).catch(saveError), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!ws) return null;
  const set = <K extends keyof Workspace>(k: K, v: Workspace[K]) => setWs({ ...ws, [k]: v });
  const text = (k: keyof Workspace) => ({
    value: (ws[k] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, (e.target.value || null) as never),
  });
  const num = (k: "sendWindowStart" | "sendWindowEnd" | "dailyLimit" | "hourlyLimit") => ({
    type: "number" as const,
    value: ws[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)),
  });

  async function save() {
    try {
      await api("/settings", {
        method: "PATCH",
        json: {
          senderName: ws!.senderName,
          senderCompany: ws!.senderCompany,
          senderAddress: ws!.senderAddress,
          fromEmail: ws!.fromEmail || null,
          replyTo: ws!.replyTo || null,
          portfolioLink: ws!.portfolioLink || null,
          timezone: ws!.timezone,
          sendWindowStart: ws!.sendWindowStart,
          sendWindowEnd: ws!.sendWindowEnd,
          dailyLimit: ws!.dailyLimit,
          hourlyLimit: ws!.hourlyLimit,
          warmupEnabled: ws!.warmupEnabled,
          jurisdictionNotes: ws!.jurisdictionNotes,
        },
      });
      toast.success("Settings saved");
      load();
    } catch (e) {
      saveError(e);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Sender identity</CardTitle>
          <CardDescription>Shown in every email. A physical address is required by CAN-SPAM and similar laws.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Sender name"><Input {...text("senderName")} /></Field>
          <Field label="Company"><Input {...text("senderCompany")} /></Field>
          <Field label="Physical address" hint="Appended to every email footer."><Input {...text("senderAddress")} /></Field>
          <Field label="From email" hint="Must be a verified sender in your email provider."><Input type="email" {...text("fromEmail")} /></Field>
          <Field label="Reply-to email"><Input type="email" {...text("replyTo")} /></Field>
          <Field label="Portfolio link"><Input type="url" {...text("portfolioLink")} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sending limits</CardTitle>
          <CardDescription>Emails outside these limits wait for the next window; nothing is dropped.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Timezone (IANA)" hint="e.g. Asia/Kolkata, Europe/London"><Input {...text("timezone")} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Window start (hour)"><Input min={0} max={23} {...num("sendWindowStart")} /></Field>
            <Field label="Window end (hour)"><Input min={0} max={24} {...num("sendWindowEnd")} /></Field>
            <Field label="Per day"><Input min={1} {...num("dailyLimit")} /></Field>
            <Field label="Per hour"><Input min={1} {...num("hourlyLimit")} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ws.warmupEnabled} onChange={(e) => set("warmupEnabled", e.target.checked)} />
            Warm-up ramp (start at 5/day, grow 1.5x per day up to the daily limit)
          </label>
          <Field label="Jurisdiction notes (CAN-SPAM / GDPR / local rules)" hint="Your own notes. Campaigns targeting opt-in regions show a warning before sending.">
            <Textarea rows={5} {...text("jurisdictionNotes")} />
          </Field>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>Providers (set in .env): email = {ws.emailProvider}, AI = {ws.aiProvider}, places = {ws.placesProvider}</p>
            <p className="mt-1 break-all">SendGrid event webhook: {ws.eventWebhookUrl}</p>
            <p className="break-all">SendGrid inbound parse (replies): {ws.inboundWebhookUrl}</p>
          </div>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Button onClick={save}>Save settings</Button>
      </div>
    </div>
  );
}

function Scoring() {
  const [cfg, setCfg] = useState<{ weights: Record<string, number>; qualifyThreshold: number; autoQueueThreshold: number } | null>(null);
  useEffect(() => {
    api<typeof cfg>("/settings/scoring").then(setCfg).catch(saveError);
  }, []);
  if (!cfg) return null;
  const labels: Record<string, string> = {
    noWebsite: "No website",
    socialOnly: "Social page only",
    broken: "Broken website",
    poorWebsite: "Poor website (max)",
    rating: "Rating",
    reviews: "Review volume",
    categoryFit: "Category fit",
  };
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Scoring weights</CardTitle>
        <CardDescription>Points per factor (normalised to a 0-100 score). Applied on the next campaign run.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {Object.keys(labels).map((k) => (
            <Field key={k} label={labels[k]!}>
              <Input type="number" min={0} value={cfg.weights[k] ?? 0} onChange={(e) => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: Number(e.target.value) } })} />
            </Field>
          ))}
          <Field label="Qualify at score" hint="Leads at or above become QUALIFIED">
            <Input type="number" min={0} max={100} value={cfg.qualifyThreshold} onChange={(e) => setCfg({ ...cfg, qualifyThreshold: Number(e.target.value) })} />
          </Field>
          <Field label="Auto-draft at score" hint="Qualified leads at or above get a drafted email">
            <Input type="number" min={0} max={100} value={cfg.autoQueueThreshold} onChange={(e) => setCfg({ ...cfg, autoQueueThreshold: Number(e.target.value) })} />
          </Field>
        </div>
        <Button
          onClick={async () => {
            try {
              await api("/settings/scoring", { method: "PUT", json: cfg });
              toast.success("Scoring saved");
            } catch (e) {
              saveError(e);
            }
          }}
        >
          Save scoring
        </Button>
      </CardContent>
    </Card>
  );
}

function Suppression() {
  const [items, setItems] = useState<{ id: string; value: string; reason: string; createdAt: string }[]>([]);
  const [text, setText] = useState("");
  const load = useCallback(() => api<{ items: typeof items }>("/suppression").then((r) => setItems(r.items)).catch(saveError), []);
  useEffect(() => {
    load();
  }, [load]);
  async function add() {
    const values = text.split(/[\s,;]+/).filter(Boolean);
    if (!values.length) return;
    try {
      const r = await api<{ added: number }>("/suppression", { method: "POST", json: { values } });
      toast.success(`${r.added} added`);
      setText("");
      load();
    } catch (e) {
      saveError(e);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suppression list</CardTitle>
        <CardDescription>Addresses and domains here are never emailed. Unsubscribes, bounces and spam complaints are added automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="name@company.com or company.com (paste many, separated by commas or spaces)" value={text} onChange={(e) => setText(e.target.value)} />
          <Button onClick={add}>Add</Button>
        </div>
        <div className="max-h-96 divide-y overflow-auto rounded-lg border">
          {items.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nothing suppressed yet.</p>}
          {items.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{s.value}</span>
              <span className="flex items-center gap-2">
                <Badge variant="outline">{s.reason}</Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove"
                  onClick={async () => {
                    await api(`/suppression/${s.id}`, { method: "DELETE" });
                    load();
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKeys() {
  const names: Record<string, string> = { GOOGLE_PLACES: "Google Places API key", SENDGRID: "SendGrid API key", ANTHROPIC: "Anthropic API key" };
  const [rows, setRows] = useState<{ provider: string; configured: boolean }[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const load = useCallback(() => api<{ items: typeof rows }>("/settings/credentials").then((r) => setRows(r.items)).catch(saveError), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>Stored encrypted and never shown again. A saved key overrides the one in .env.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((r) => (
          <div key={r.provider} className="space-y-1">
            <Label className="flex items-center gap-2">
              {names[r.provider]} {r.configured && <Badge>configured</Badge>}
            </Label>
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" placeholder={r.configured ? "Enter a new key to replace it" : "Paste key"} value={values[r.provider] ?? ""} onChange={(e) => setValues({ ...values, [r.provider]: e.target.value })} />
              <Button
                disabled={!values[r.provider]}
                onClick={async () => {
                  try {
                    await api(`/settings/credentials/${r.provider}`, { method: "PUT", json: { value: values[r.provider] } });
                    setValues({ ...values, [r.provider]: "" });
                    toast.success("Key saved");
                    load();
                  } catch (e) {
                    saveError(e);
                  }
                }}
              >
                Save
              </Button>
              {r.configured && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await api(`/settings/credentials/${r.provider}`, { method: "DELETE" });
                    load();
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TriggerApiKey() {
  const [has, setHas] = useState<boolean | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const load = useCallback(() => api<{ hasApiKey: boolean }>("/settings").then((s) => setHas(s.hasApiKey)).catch(saveError), []);
  useEffect(() => {
    load();
  }, [load]);
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Automation API key</CardTitle>
        <CardDescription>Lets scripts or other tools start a campaign run. Shown once when created; only a hash is stored.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {has ? <Badge>active</Badge> : <Badge variant="outline">none</Badge>}
          <Button
            variant="outline"
            onClick={async () => {
              if (has && !confirm("Generate a new key? The current key stops working immediately.")) return;
              try {
                const r = await api<{ apiKey: string }>("/settings/api-key", { method: "POST" });
                setFresh(r.apiKey);
                load();
              } catch (e) {
                saveError(e);
              }
            }}
          >
            {has ? "Rotate key" : "Generate key"}
          </Button>
          {has && (
            <Button
              variant="ghost"
              onClick={async () => {
                await api("/settings/api-key", { method: "DELETE" });
                setFresh(null);
                load();
              }}
            >
              Revoke
            </Button>
          )}
        </div>
        {fresh && (
          <div className="space-y-1 rounded-lg border border-primary/30 bg-brand-soft p-3 text-sm">
            <p className="font-medium">Copy this key now. You will not see it again.</p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1 text-xs">{fresh}</code>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(fresh).then(() => toast.success("Copied"))}>
                Copy
              </Button>
            </div>
          </div>
        )}
        <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs">{`curl -X POST ${apiBase}/api/v1/trigger/campaigns/<campaign-id>/run \\
  -H "x-api-key: <your key>" \\
  -H "Idempotency-Key: <optional unique id>"`}</pre>
        <p className="text-xs text-muted-foreground">Returns 202 with the run id, or 409 if that campaign already has a run in progress. Repeating the same Idempotency-Key within 24 hours returns the original run.</p>
      </CardContent>
    </Card>
  );
}

function Checklist() {
  const [items, setItems] = useState<{ key: string; label: string }[]>([...DEFAULT_CHECKLIST]);
  useEffect(() => {
    api<{ items: { key: string; label: string }[] | null }>("/settings/checklist").then((r) => r.items && setItems(r.items)).catch(() => {});
  }, []);
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Lead checklist</CardTitle>
        <CardDescription>Applies to leads created from now on. Items with the default keys tick automatically from system events.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((it, i) => (
          <div key={it.key} className="flex gap-2">
            <Input value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => setItems([...items, { key: `custom_${Date.now().toString(36)}`, label: "New item" }])}>
            Add item
          </Button>
          <Button
            onClick={async () => {
              try {
                await api("/settings/checklist", { method: "PUT", json: { items } });
                toast.success("Checklist saved");
              } catch (e) {
                saveError(e);
              }
            }}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Who your emails come from, how fast they go out, how leads are scored, and who must never be contacted." />
      <Tabs defaultValue="sender">
        <TabsList className="flex-wrap">
          <TabsTrigger value="sender">Sender &amp; limits</TabsTrigger>
          <TabsTrigger value="scoring">Scoring</TabsTrigger>
          <TabsTrigger value="suppression">Suppression</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
        </TabsList>
        <TabsContent value="sender" className="pt-4"><SenderAndSending /></TabsContent>
        <TabsContent value="scoring" className="pt-4"><Scoring /></TabsContent>
        <TabsContent value="suppression" className="pt-4"><Suppression /></TabsContent>
        <TabsContent value="keys" className="space-y-4 pt-4"><ApiKeys /><TriggerApiKey /></TabsContent>
        <TabsContent value="checklist" className="pt-4"><Checklist /></TabsContent>
      </Tabs>
    </div>
  );
}
