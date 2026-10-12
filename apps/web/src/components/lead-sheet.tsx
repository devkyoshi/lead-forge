"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LEAD_STATUSES } from "@leadforge/shared";
import { api, type LeadDetail } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "@/components/score-badge";
import { ActivityTimeline } from "@/components/activity-timeline";
import { NEEDS_DETAILS, StatusChangeDialog } from "@/components/status-change-dialog";
import { StatusBadge, humanize } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface EmailThread {
  messages: {
    id: string;
    direction: "OUT" | "IN";
    toEmail: string;
    status: string;
    sentAt: string | null;
    body: string | null;
    draft: { subject: string; step: number } | null;
    events: { type: string; occurredAt: string }[];
  }[];
  drafts: { id: string; subject: string; step: number; status: string; lastError: string | null }[];
}

export function LeadSheet({
  leadId,
  onClose,
  onChanged,
}: {
  leadId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [note, setNote] = useState("");
  // Pending status change that needs extra input (reason / project details).
  const [pending, setPending] = useState<string | null>(null);
  const [emails, setEmails] = useState<EmailThread | null>(null);
  const [timelineKey, setTimelineKey] = useState(0);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [tagInput, setTagInput] = useState("");

  const load = useCallback(async () => {
    if (!leadId) return;
    try {
      setLead(await api<LeadDetail>(`/leads/${leadId}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load lead");
    }
  }, [leadId]);

  const loadEmails = useCallback(async () => {
    if (!leadId) return;
    try {
      setEmails(await api<EmailThread>(`/leads/${leadId}/emails`));
    } catch {
      setEmails(null);
    }
  }, [leadId]);

  useEffect(() => {
    setLead(null);
    setEmails(null);
    load();
    loadEmails();
  }, [load, loadEmails]);

  async function logReply() {
    try {
      await api(`/leads/${leadId}/log-reply`, { method: "POST", json: {} });
      toast.success("Reply logged; follow-ups stopped");
      await Promise.all([load(), loadEmails()]);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not log reply");
    }
  }

  async function eraseData() {
    if (!confirm("Permanently erase this lead and all its data, and suppress its email addresses? This cannot be undone.")) return;
    try {
      await api(`/leads/${leadId}/data`, { method: "DELETE" });
      toast.success("Lead erased");
      onClose();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erase failed");
    }
  }

  useEffect(() => {
    api<{ items: { id: string; name: string }[] }>("/team").then((r) => setTeam(r.items)).catch(() => {});
  }, []);

  /** Saves tags or the assignee and updates the open sheet in place. */
  async function updateLead(patch: { tags?: string[]; assignedTo?: string | null }) {
    try {
      await api(`/leads/${leadId}`, { method: "PATCH", json: patch });
      setLead((l) => (l ? { ...l, ...patch } : l));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || !lead || lead.tags.includes(t)) return setTagInput("");
    updateLead({ tags: [...lead.tags, t] });
    setTagInput("");
  }

  async function changeStatus(status: string, extra: Record<string, unknown> = {}) {
    try {
      await api(`/leads/${leadId}/status`, { method: "POST", json: { status, ...extra } });
      toast.success(`Moved to ${humanize(status)}`);
      setPending(null);
      setTimelineKey((k) => k + 1);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status change failed");
    }
  }

  function requestStatus(status: string | null) {
    if (!status || status === lead?.status) return;
    if (NEEDS_DETAILS.includes(status)) setPending(status);
    else changeStatus(status);
  }

  async function toggle(key: string, done: boolean) {
    await api(`/leads/${leadId}/checklist/${key}`, { method: "PATCH", json: { done } });
    await load();
  }

  async function addNote() {
    if (!note.trim()) return;
    await api(`/leads/${leadId}/notes`, { method: "POST", json: { body: note } });
    setNote("");
    await load();
  }

  return (
    <>
      <Sheet open={!!leadId} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{lead?.name ?? "Lead"}</SheetTitle>
            <SheetDescription>{lead?.address ?? ""}</SheetDescription>
          </SheetHeader>
          {!lead ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ScoreBadge score={lead.score} />
                <StatusBadge status={lead.websiteStatus} />
                <Select value={lead.status} onValueChange={requestStatus}>
                  <SelectTrigger className="w-48">
                    <SelectValue>{humanize(lead.status)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {humanize(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground">
                {[lead.phone, lead.category, lead.area].filter(Boolean).join(" · ")}
              </div>

              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Assigned to</p>
                  <Select value={lead.assignedTo ?? "none"} onValueChange={(v) => updateLead({ assignedTo: !v || v === "none" ? null : v })}>
                    <SelectTrigger className="h-8 w-full bg-background">
                      <SelectValue>{lead.assignedTo ? (team.find((t) => t.id === lead.assignedTo)?.name ?? "Unknown") : "Unassigned"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {team.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Tags</p>
                  <div className="flex flex-wrap items-center gap-1">
                    {lead.tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-accent-foreground">
                        {t}
                        <button type="button" aria-label={`Remove tag ${t}`} className="rounded-full hover:text-destructive" onClick={() => updateLead({ tags: lead.tags.filter((x) => x !== t) })}>
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      onBlur={addTag}
                      placeholder={lead.tags.length ? "Add tag" : "Add a tag and press Enter"}
                      className="h-7 w-36 bg-background text-xs"
                    />
                  </div>
                </div>
              </div>

              <Tabs defaultValue="audit">
                <TabsList>
                  <TabsTrigger value="audit">Audit &amp; score</TabsTrigger>
                  <TabsTrigger value="emails">Emails</TabsTrigger>
                  <TabsTrigger value="checklist">Checklist</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
                <TabsContent value="audit" className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Score breakdown</h4>
                    {lead.scoreBreakdown?.length ? (
                      lead.scoreBreakdown.map((b) => (
                        <div key={b.key} className="text-sm">
                          <div className="flex justify-between">
                            <span>{b.label}</span>
                            <span className="text-muted-foreground">
                              {b.points} / {b.max}
                            </span>
                          </div>
                          <div className="h-1.5 rounded bg-muted">
                            <div
                              className="h-1.5 rounded bg-primary"
                              style={{ width: `${b.max ? Math.min(100, (b.points / b.max) * 100) : 0}%` }}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground">{b.detail}</div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Not scored yet.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Website issues</h4>
                    {lead.websiteUrl && <p className="break-all text-xs text-muted-foreground">{lead.websiteUrl}</p>}
                    {lead.audits[0]?.issues.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {lead.audits[0].issues.map((i) => (
                          <li key={i.code}>{i.message}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {lead.audits.length ? "No issues found." : "Not audited yet."}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-medium">Contacts</h4>
                    {lead.contacts?.length ? (
                      (lead.contacts as { id: string; value: string; source: string | null; confidence: number | null }[]).map((c) => (
                        <div key={c.id} className="text-sm">
                          {c.value}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({c.source}, confidence {c.confidence ?? "n/a"})
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No public email found. Needs manual outreach (phone / WhatsApp / DM).
                      </p>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="emails" className="space-y-3">
                  {!emails || (!emails.messages.length && !emails.drafts.length) ? (
                    <p className="text-sm text-muted-foreground">No emails yet.</p>
                  ) : (
                    <>
                      {emails.messages.map((m) => (
                        <div key={m.id} className={`rounded-lg border p-3 text-sm ${m.direction === "IN" ? "border-primary/40 bg-brand-soft" : "bg-card"}`}>
                          <div className="flex justify-between">
                            <strong>{m.direction === "IN" ? "Reply received" : (m.draft?.subject ?? "Email")}</strong>
                            <span className="text-xs text-muted-foreground">{m.sentAt ? new Date(m.sentAt).toLocaleString() : m.status}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {m.direction === "OUT" ? `to ${m.toEmail}` : `from ${m.toEmail}`}
                            {m.draft && m.draft.step > 0 ? ` · follow-up ${m.draft.step}` : ""}
                          </div>
                          {m.body && <p className="mt-1 whitespace-pre-wrap text-xs">{m.body}</p>}
                          {m.events.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {m.events.map((ev, i) => (
                                <Badge key={i} variant="outline">{ev.type.toLowerCase()}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {emails.drafts.map((d) => (
                        <div key={d.id} className="rounded-lg border border-dashed p-3 text-sm">
                          <div className="flex justify-between">
                            <span>{d.subject}</span>
                            <StatusBadge status={d.status} />
                          </div>
                          {d.lastError && <p className="text-xs text-muted-foreground">{d.lastError}</p>}
                        </div>
                      ))}
                    </>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={logReply} disabled={!emails?.messages.some((m) => m.direction === "OUT")}>
                      Log a reply
                    </Button>
                    <Button size="sm" variant="outline" onClick={eraseData}>
                      Erase lead data
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="checklist" className="space-y-2">
                  <div className="mb-3 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Progress</span>
                      <span className="tabular-nums">
                        {lead.checklist.filter((c) => c.done).length} of {lead.checklist.length}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${lead.checklist.length ? (lead.checklist.filter((c) => c.done).length / lead.checklist.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                  {lead.checklist.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={c.done} onCheckedChange={(v) => toggle(c.key, v === true)} />
                      <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
                    </label>
                  ))}
                </TabsContent>
                <TabsContent value="timeline">
                  <ActivityTimeline leadId={lead.id} refreshKey={timelineKey} />
                </TabsContent>
                <TabsContent value="notes" className="space-y-3">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note..." />
                  <Button size="sm" onClick={addNote}>
                    Add note
                  </Button>
                  {lead.notes.map((n) => (
                    <div key={n.id} className="rounded-lg border bg-card p-3 text-sm">
                      <p className="whitespace-pre-wrap">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <StatusChangeDialog
        status={pending}
        leadName={lead?.name}
        onCancel={() => setPending(null)}
        onSubmit={(status, extra) => changeStatus(status, extra as Record<string, unknown>)}
      />
    </>
  );
}
