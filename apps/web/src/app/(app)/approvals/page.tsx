"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface Draft {
  id: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  aiGenerated: boolean;
  status: string;
  variablesUsed: { _warnings?: string[] };
  lead: { id: string; name: string; score: number; websiteStatus: string; contacts: { value: string }[] };
  campaign: { name: string } | null;
}

export default function ApprovalsPage() {
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [items, setItems] = useState<Draft[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Draft | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Draft[] }>(`/drafts?status=${status}`)).items);
      setPicked(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load drafts");
    }
  }, [status]);
  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  async function bulk(action: "approve" | "reject" | "regenerate", ids = [...picked]) {
    if (!ids.length) return;
    try {
      const res = await api<{ changed: number; skipped: { reason: string }[] }>("/drafts/bulk", { method: "POST", json: { ids, action } });
      toast.success(`${res.changed} draft(s) ${action === "regenerate" ? "regenerated" : action + "d"}`);
      res.skipped.forEach((s) => toast.warning(`Skipped one: ${s.reason}`));
      setOpen(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function saveEdit() {
    if (!open) return;
    try {
      await api(`/drafts/${open.id}`, { method: "PATCH", json: { subject, bodyText: text } });
      toast.success("Draft updated (back in review)");
      setOpen(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  function openDraft(d: Draft) {
    setOpen(d);
    setSubject(d.subject);
    setText(d.bodyText);
  }

  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Approval queue</h1>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={status} onValueChange={(v) => setStatus(String(v))}>
          <TabsList>
            <TabsTrigger value="PENDING_REVIEW">Pending</TabsTrigger>
            <TabsTrigger value="APPROVED">Approved</TabsTrigger>
            <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <Button size="sm" disabled={!picked.size} onClick={() => bulk("approve")}>
            <Check className="size-4" /> Approve ({picked.size})
          </Button>
          <Button size="sm" variant="outline" disabled={!picked.size} onClick={() => bulk("regenerate")}>
            <RefreshCw className="size-4" /> Regenerate
          </Button>
          <Button size="sm" variant="outline" disabled={!picked.size} onClick={() => bulk("reject")}>
            <X className="size-4" /> Reject
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={!!items?.length && picked.size === items.length}
                  onCheckedChange={(v) => setPicked(v === true && items ? new Set(items.map((i) => i.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Campaign</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!items ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  Nothing here.
                </TableCell>
              </TableRow>
            ) : (
              items.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => openDraft(d)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={picked.has(d.id)} onCheckedChange={(v) => toggle(d.id, v === true)} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{d.lead.name}</div>
                    <div className="text-xs text-muted-foreground">
                      score {d.lead.score} · {d.lead.websiteStatus.replace("_", " ")}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{d.lead.contacts[0]?.value ?? "-"}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm">
                    {d.subject} {d.aiGenerated && <Badge variant="secondary">AI</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.campaign?.name ?? "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review draft: {open?.lead.name}</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">To: {open.lead.contacts[0]?.value ?? "no email"}</p>
              {open.variablesUsed._warnings?.map((w) => (
                <p key={w} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
              ))}
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              <Textarea rows={16} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={saveEdit} disabled={subject === open.subject && text === open.bodyText}>
                  Save edits
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => bulk("reject", [open.id])}>Reject</Button>
                  <Button onClick={() => bulk("approve", [open.id])} disabled={subject !== open.subject || text !== open.bodyText}>
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
