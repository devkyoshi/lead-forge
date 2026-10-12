"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { api, type Campaign } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SchedulePicker, browserTimezone, type Schedule } from "@/components/schedule-picker";

interface Values {
  name: string;
  areaLabel: string;
  mode: "city" | "radius";
  lat: string;
  lng: string;
  radiusKm: string;
  categories: string;
  minRating: string;
  dailySendLimit: string;
  approvalMode: "REVIEW_FIRST" | "AUTO_SEND";
  tone: "friendly" | "professional" | "concise";
  aiPersonalize: boolean;
  followups: boolean;
  templateId: string;
}

interface Template {
  id: string;
  name: string;
  scenario: string;
}

/** Shape of the fields the dialog needs from an existing campaign (the API returns the whole row). */
type EditableCampaign = Campaign & {
  area: { type: "city" | "radius"; label: string; query?: string; lat?: number; lng?: number; radiusKm?: number };
  filters?: { minRating?: number };
  tone?: Values["tone"];
  aiPersonalize?: boolean;
  followupSequence?: unknown[];
  templateId?: string | null;
};

const EMPTY: Values = {
  name: "",
  areaLabel: "",
  mode: "city",
  lat: "",
  lng: "",
  radiusKm: "5",
  categories: "hotel, restaurant",
  minRating: "",
  dailySendLimit: "25",
  approvalMode: "REVIEW_FIRST",
  tone: "friendly",
  aiPersonalize: true,
  followups: true,
  templateId: "auto",
};

function valuesFor(c: EditableCampaign): Values {
  return {
    name: c.name,
    areaLabel: c.area.label,
    mode: c.area.type,
    lat: c.area.lat != null ? String(c.area.lat) : "",
    lng: c.area.lng != null ? String(c.area.lng) : "",
    radiusKm: c.area.radiusKm != null ? String(c.area.radiusKm) : "5",
    categories: c.categories.join(", "),
    minRating: c.filters?.minRating != null ? String(c.filters.minRating) : "",
    dailySendLimit: String(c.dailySendLimit),
    approvalMode: c.approvalMode as Values["approvalMode"],
    tone: c.tone ?? "friendly",
    aiPersonalize: c.aiPersonalize ?? true,
    followups: (c.followupSequence?.length ?? 0) > 0,
    templateId: c.templateId ?? "auto",
  };
}

const selectClass = "h-9 w-full rounded-md border bg-transparent px-2 text-sm";

/** Create a campaign, or edit an existing one when `campaign` is given. */
export function CampaignDialog({
  open,
  onOpenChange,
  onSaved,
  campaign,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  campaign?: Campaign | null;
}) {
  const editing = campaign as EditableCampaign | null | undefined;
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<Values>({ defaultValues: EMPTY });
  const mode = watch("mode");
  const [schedule, setSchedule] = useState<Schedule>({ cron: null, timezone: browserTimezone() });
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    if (!open) return;
    reset(editing ? valuesFor(editing) : EMPTY);
    setSchedule(editing ? { cron: editing.cron, timezone: editing.cron ? editing.timezone : browserTimezone() } : { cron: null, timezone: browserTimezone() });
    api<{ items: Template[] }>("/templates").then((r) => setTemplates(r.items)).catch(() => {});
  }, [open, editing, reset]);

  async function onSubmit(v: Values) {
    const categories = v.categories
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const area =
      v.mode === "city"
        ? { type: "city", label: v.areaLabel, query: v.areaLabel }
        : { type: "radius", label: v.areaLabel, lat: Number(v.lat), lng: Number(v.lng), radiusKm: Number(v.radiusKm) };
    const payload = {
      name: v.name,
      area,
      categories,
      filters: v.minRating ? { minRating: Number(v.minRating) } : {},
      dailySendLimit: Number(v.dailySendLimit),
      approvalMode: v.approvalMode,
      tone: v.tone,
      aiPersonalize: v.aiPersonalize,
      templateId: v.templateId === "auto" ? null : v.templateId,
      followupSequence: v.followups
        ? [
            { delayDays: 3, scenario: "FOLLOWUP_1" },
            { delayDays: 7, scenario: "FOLLOWUP_2" },
          ]
        : [],
      cron: schedule.cron,
      timezone: schedule.timezone,
    };
    try {
      const saved = editing
        ? await api<{ id: string }>(`/campaigns/${editing.id}`, { method: "PATCH", json: payload })
        : await api<{ id: string }>("/campaigns", { method: "POST", json: payload });
      toast.success(editing ? "Campaign updated" : "Campaign created");
      const check = await api<{ errors: string[]; warnings: string[] }>(`/campaigns/${saved.id}/validate`, { method: "POST" }).catch(() => null);
      check?.errors.forEach((m) => toast.error(m, { duration: 12000 }));
      check?.warnings.forEach((m) => toast.warning(m, { duration: 12000 }));
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the campaign");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit campaign" : "New campaign"}</DialogTitle>
          <DialogDescription>Where to look, what to look for, and how to reach the businesses you find.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required {...register("name")} />
          </div>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Area</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="areaLabel">City or region</Label>
                <Input id="areaLabel" required placeholder="Pune" {...register("areaLabel")} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mode">Search by</Label>
                <select id="mode" className={selectClass} {...register("mode")}>
                  <option value="city">City / region name</option>
                  <option value="radius">Center point + radius</option>
                </select>
              </div>
            </div>
            {mode === "radius" && (
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label>Latitude</Label>
                  <Input type="number" step="any" required {...register("lat")} />
                </div>
                <div className="space-y-1">
                  <Label>Longitude</Label>
                  <Input type="number" step="any" required {...register("lng")} />
                </div>
                <div className="space-y-1">
                  <Label>Radius km</Label>
                  <Input type="number" step="any" required {...register("radiusKm")} />
                </div>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Targeting</legend>
            <div className="space-y-1">
              <Label htmlFor="categories">Categories (comma separated)</Label>
              <Input id="categories" required {...register("categories")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Minimum rating</Label>
                <Input type="number" step="0.1" min="0" max="5" placeholder="Any" {...register("minRating")} />
              </div>
              <div className="space-y-1">
                <Label>Daily send limit</Label>
                <Input type="number" min="1" {...register("dailySendLimit")} />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</legend>
            <div className="space-y-1">
              <Label htmlFor="templateId">Template</Label>
              <select id="templateId" className={selectClass} {...register("templateId")}>
                <option value="auto">Automatic: best match for each lead</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Automatic picks the no-website or poor-website template for each lead. A specific template is used for every lead.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="approvalMode">Approval</Label>
                <select id="approvalMode" className={selectClass} {...register("approvalMode")}>
                  <option value="REVIEW_FIRST">Review each draft first</option>
                  <option value="AUTO_SEND">Auto-send</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="tone">Tone</Label>
                <select id="tone" className={selectClass} {...register("tone")}>
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                  <option value="concise">Concise</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register("aiPersonalize")} /> AI personalise each email
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register("followups")} /> Follow-ups after 3 and 7 days (stop on reply, unsubscribe or bounce)
            </label>
          </fieldset>

          <fieldset className="rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Schedule</legend>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </fieldset>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {editing ? "Save changes" : "Create campaign"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
