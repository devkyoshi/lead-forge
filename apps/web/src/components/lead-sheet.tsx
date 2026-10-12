"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LEAD_STATUSES } from "@leadforge/shared";
import { api, type LeadDetail } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
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

  useEffect(() => {
    setLead(null);
    load();
  }, [load]);

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
                <Badge>{lead.score}</Badge>
                <Badge variant="outline">{lead.websiteStatus.replace("_", " ")}</Badge>
                <Select value={lead.status} onValueChange={requestStatus}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
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
                    <div key={n.id} className="rounded-md border p-2 text-sm">
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
