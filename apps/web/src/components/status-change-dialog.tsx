"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { humanize } from "@/components/status-badge";

/** Statuses that must collect extra information before the move is allowed. */
export const NEEDS_DETAILS = ["CONFIRMED", "LOST", "NOT_INTERESTED"];

export interface StatusExtra {
  reason?: string;
  project?: { name: string; value?: number; notes?: string; expectedStart?: string };
}

/**
 * Asks for project details when a lead is confirmed, or a reason when it is lost / not interested.
 * Shared by the lead sheet and the pipeline board so both enforce the same rules as the API.
 */
export function StatusChangeDialog({
  status,
  leadName,
  onCancel,
  onSubmit,
}: {
  status: string | null;
  leadName?: string;
  onCancel: () => void;
  onSubmit: (status: string, extra: StatusExtra) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [project, setProject] = useState({ name: "", value: "", notes: "", expectedStart: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status) {
      setReason("");
      setProject({ name: "", value: "", notes: "", expectedStart: "" });
      setBusy(false);
    }
  }, [status]);

  async function submit(extra: StatusExtra) {
    if (!status) return;
    setBusy(true);
    try {
      await onSubmit(status, extra);
    } finally {
      setBusy(false);
    }
  }

  const confirming = status === "CONFIRMED";
  return (
    <Dialog open={!!status} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirming ? "Confirm the deal" : `Mark as ${status ? humanize(status).toLowerCase() : ""}`}</DialogTitle>
          <DialogDescription>
            {confirming ? `Record the project details${leadName ? ` for ${leadName}` : ""}.` : `Why is ${leadName ?? "this lead"} being closed? This is saved on the lead's timeline.`}
          </DialogDescription>
        </DialogHeader>
        {confirming ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Project name</Label>
              <Input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} placeholder="e.g. Website redesign" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Value</Label>
                <Input type="number" min={0} value={project.value} onChange={(e) => setProject({ ...project, value: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Expected start</Label>
                <Input type="date" value={project.expectedStart} onChange={(e) => setProject({ ...project, expectedStart: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={project.notes} onChange={(e) => setProject({ ...project, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                disabled={busy || !project.name.trim()}
                onClick={() =>
                  submit({
                    project: {
                      name: project.name.trim(),
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
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" rows={4} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button disabled={busy || !reason.trim()} onClick={() => submit({ reason: reason.trim() })}>
                Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
