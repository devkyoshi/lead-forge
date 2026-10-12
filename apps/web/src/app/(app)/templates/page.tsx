"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { TEMPLATE_VARIABLES, TONES } from "@leadforge/shared";
import { api, type Lead } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Version {
  id: string;
  version: number;
  subject: string;
  bodyMd: string;
  createdAt: string;
}
interface Template {
  id: string;
  name: string;
  category: string;
  scenario: string;
  versions: Version[];
}
interface Stats {
  drafts: number;
  sent: number;
  opened: number;
  replied: number;
  converted: number;
}
interface Preview {
  subject: string;
  bodyHtml: string;
  aiGenerated: boolean;
  warnings: string[];
}

const SCENARIOS = ["NO_WEBSITE", "POOR_WEBSITE", "FOLLOWUP_1", "FOLLOWUP_2"];
const CATEGORIES = ["generic", "hotel", "restaurant", "shop"];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("generic");
  const [scenario, setScenario] = useState("NO_WEBSITE");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [leadId, setLeadId] = useState<string>("");
  const [tone, setTone] = useState<string>("friendly");
  const [ai, setAi] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(async () => {
    const res = await api<{ items: (Template & { versions: Version[] })[] }>("/templates");
    setTemplates(res.items);
    return res.items;
  }, []);

  useEffect(() => {
    loadList().catch((e) => toast.error(e.message));
    api<{ items: Lead[] }>("/leads?pageSize=50&sort=score&dir=desc")
      .then((r) => {
        setLeads(r.items);
        if (r.items[0]) setLeadId(r.items[0].id);
      })
      .catch(() => {});
  }, [loadList]);

  async function select(t: Template) {
    setSelected(t.id);
    setName(t.name);
    setCategory(t.category);
    setScenario(t.scenario);
    const full = await api<{ versions: Version[] }>(`/templates/${t.id}`);
    setVersions(full.versions);
    setSubject(full.versions[0]?.subject ?? "");
    setBody(full.versions[0]?.bodyMd ?? "");
    setStats(await api<Stats>(`/templates/${t.id}/stats`));
  }

  function startNew() {
    setSelected("new");
    setName("");
    setCategory("generic");
    setScenario("NO_WEBSITE");
    setSubject("");
    setBody("");
    setVersions([]);
    setStats(null);
  }

  // Debounced live preview against the chosen lead.
  useEffect(() => {
    if (!selected || !leadId || !body) return;
    const t = setTimeout(async () => {
      try {
        setPreview(await api<Preview>("/templates/preview", { method: "POST", json: { leadId, subject, body, tone, ai } }));
      } catch (e) {
        setPreview(null);
        toast.error(e instanceof Error ? e.message : "Preview failed");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [selected, leadId, subject, body, tone, ai]);

  function insertVariable(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: s, selectionEnd: e } = el;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  async function save() {
    try {
      if (selected === "new") {
        const t = await api<Template>("/templates", { method: "POST", json: { name, category, scenario, subject, body } });
        toast.success("Template created");
        await loadList();
        await select(t);
      } else if (selected) {
        await api(`/templates/${selected}`, { method: "PATCH", json: { name, category, scenario } });
        await api(`/templates/${selected}/versions`, { method: "POST", json: { subject, body } });
        toast.success("Saved as a new version");
        const items = await loadList();
        const t = items.find((x) => x.id === selected);
        if (t) await select(t);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <Button onClick={startNew}>
          <Plus className="size-4" /> New template
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t)}
              className={`w-full rounded-md border p-3 text-left text-sm hover:bg-muted ${selected === t.id ? "bg-muted" : ""}`}
            >
              <div className="font-medium">{t.name}</div>
              <div className="mt-1 flex gap-1">
                <Badge variant="outline">{t.scenario.replace("_", " ")}</Badge>
                <Badge variant="secondary">{t.category}</Badge>
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-3 space-y-1">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="col-span-3 space-y-1 sm:col-span-2">
                  <Label>Scenario</Label>
                  <Select value={scenario} onValueChange={(v) => v && setScenario(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SCENARIOS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 space-y-1 sm:col-span-1">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Body (markdown)</Label>
                <Textarea ref={bodyRef} rows={16} className="font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_VARIABLES.map((v) => (
                  <Button key={v.key} type="button" size="xs" variant="outline" title={v.label} onClick={() => insertVariable(v.key)}>
                    {`{{${v.key.split("|")[0]}}}`}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={save} disabled={!name || !subject || !body}>
                  {selected === "new" ? "Create template" : "Save new version"}
                </Button>
                {stats && (
                  <span className="text-xs text-muted-foreground">
                    {stats.sent} sent · {stats.opened} opened · {stats.replied} replied · {stats.converted} converted
                  </span>
                )}
              </div>
              {versions.length > 0 && (
                <div className="space-y-1">
                  <Label>Version history</Label>
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      className="flex w-full justify-between rounded border px-2 py-1 text-xs hover:bg-muted"
                      onClick={() => {
                        setSubject(v.subject);
                        setBody(v.bodyMd);
                      }}
                    >
                      <span>v{v.version}</span>
                      <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString()} (load into editor)</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label>Preview with lead</Label>
                  <Select value={leadId} onValueChange={(v) => v && setLeadId(v)}>
                    <SelectTrigger><SelectValue placeholder="Choose a lead" /></SelectTrigger>
                    <SelectContent>
                      {leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Tone</Label>
                  <Select value={tone} onValueChange={(v) => v && setTone(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <Checkbox checked={ai} onCheckedChange={(v) => setAi(v === true)} /> AI personalize
                </label>
              </div>
              <div className="rounded-md border p-4">
                {preview ? (
                  <>
                    <p className="text-sm text-muted-foreground">Subject</p>
                    <p className="mb-3 font-medium">{preview.subject}</p>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&_a]:underline [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} />
                    {preview.aiGenerated && <Badge className="mt-2">AI-personalised</Badge>}
                    {preview.warnings.map((w) => (
                      <p key={w} className="mt-2 text-xs text-amber-600 dark:text-amber-400">{w}</p>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Preview appears here.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select a template to edit it, or create a new one.</p>
        )}
      </div>
    </div>
  );
}
