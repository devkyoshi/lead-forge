"use client";

import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
}

export function CampaignDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<Values>({
    defaultValues: {
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
    },
  });
  const mode = watch("mode");

  async function onSubmit(v: Values) {
    const categories = v.categories
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const area =
      v.mode === "city"
        ? { type: "city", label: v.areaLabel, query: v.areaLabel }
        : { type: "radius", label: v.areaLabel, lat: Number(v.lat), lng: Number(v.lng), radiusKm: Number(v.radiusKm) };
    try {
      await api("/campaigns", {
        method: "POST",
        json: {
          name: v.name,
          area,
          categories,
          filters: v.minRating ? { minRating: Number(v.minRating) } : {},
          dailySendLimit: Number(v.dailySendLimit),
          approvalMode: v.approvalMode,
          tone: v.tone,
          aiPersonalize: v.aiPersonalize,
        },
      });
      toast.success("Campaign created");
      reset();
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create campaign");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required {...register("name")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="areaLabel">Area (city or region)</Label>
            <Input id="areaLabel" required placeholder="Pune" {...register("areaLabel")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mode">Search by</Label>
            <select id="mode" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" {...register("mode")}>
              <option value="city">City / region name</option>
              <option value="radius">Center point + radius</option>
            </select>
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
          <div className="space-y-1">
            <Label htmlFor="categories">Categories (comma separated)</Label>
            <Input id="categories" required {...register("categories")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Min rating</Label>
              <Input type="number" step="0.1" min="0" max="5" {...register("minRating")} />
            </div>
            <div className="space-y-1">
              <Label>Daily send limit</Label>
              <Input type="number" min="1" {...register("dailySendLimit")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="approvalMode">Approval</Label>
              <select id="approvalMode" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" {...register("approvalMode")}>
                <option value="REVIEW_FIRST">Review first</option>
                <option value="AUTO_SEND">Auto-send</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tone">Tone</Label>
              <select id="tone" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" {...register("tone")}>
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="concise">Concise</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("aiPersonalize")} /> AI personalize emails
          </label>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Create campaign
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
