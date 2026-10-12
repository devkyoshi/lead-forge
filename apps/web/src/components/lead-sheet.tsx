"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LEAD_STATUSES } from "@leadforge/shared";
import { api, type LeadDetail } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge, humanize } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [reason, setReason] = useState("");
  const [project, setProject] = useState({ name: "", value: "", notes: "", expectedStart: "" });

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

  async function changeStatus(status: string, extra: Record<string, unknown> = {}) {
    try {
      await api(`/leads/${leadId}/status`, { method: "POST", json: { status, ...extra } });
      toast.success(`Moved to ${status}`);
      setPending(null);
      setReason("");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status change failed");
    }
  }

  function requestStatus(status: string | null) {
    if (!status || status === lead?.status) return;
    if (["LOST", "NOT_INTERESTED", "CONFIRMED"].includes(status)) setPending(status);
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
                  {lead.checklist.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={c.done} onCheckedChange={(v) => toggle(c.key, v === true)} />
                      <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
                    </label>
                  ))}
                </TabsContent>
                <TabsContent value="timeline" className="space-y-3">
                  {lead.history.map((h) => (
                    <div key={h.id} className="text-sm">
                      <div>
                        {h.fromStatus ? `${h.fromStatus} → ` : ""}
                        <strong>{h.toStatus}</strong>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {h.actor === "system" ? "system" : "user"} · {new Date(h.createdAt).toLocaleString()}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </div>
                    </div>
                  ))}
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

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending === "CONFIRMED" ? "Project details" : `Why ${pending}?`}</DialogTitle>
          </DialogHeader>
          {pending === "CONFIRMED" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Project name</Label>
                <Input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Value</Label>
                <Input type="number" value={project.value} onChange={(e) => setProject({ ...project, value: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Expected start</Label>
                <Input type="date" value={project.expectedStart} onChange={(e) => setProject({ ...project, expectedStart: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={project.notes} onChange={(e) => setProject({ ...project, notes: e.target.value })} />
              </div>
              <Button
                className="w-full"
                disabled={!project.name.trim()}
                onClick={() =>
                  changeStatus("CONFIRMED", {
                    project: {
                      name: project.name,
                      value: project.value ? Number(project.value) : undefined,
                      notes: project.notes || undefined,
                      expectedStart: project.expectedStart || undefined,
                    },
                  })
                }
              >
                Confirm deal
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
              <Button className="w-full" disabled={!reason.trim()} onClick={() => changeStatus(pending!, { reason })}>
                Save
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
