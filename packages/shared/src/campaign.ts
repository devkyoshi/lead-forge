import { z } from "zod";
import { followupSequenceSchema } from "./sending";

export const areaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("radius"),
    label: z.string().min(1).max(120),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusKm: z.number().min(0.5).max(100),
  }),
  z.object({ type: z.literal("city"), label: z.string().min(1).max(120), query: z.string().min(1).max(200) }),
]);
export type Area = z.infer<typeof areaSchema>;

export const campaignFiltersSchema = z.object({
  minRating: z.number().min(0).max(5).optional(),
  minReviews: z.number().int().min(0).optional(),
});

export const campaignCreateSchema = z.object({
  name: z.string().min(1).max(120),
  area: areaSchema,
  categories: z.array(z.string().min(1).max(60)).min(1).max(20),
  templateId: z.string().optional(),
  followupSequence: followupSequenceSchema.default([]),
  filters: campaignFiltersSchema.default({}),
  dailySendLimit: z.number().int().min(1).max(1000).default(25),
  approvalMode: z.enum(["REVIEW_FIRST", "AUTO_SEND"]).default("REVIEW_FIRST"),
  aiPersonalize: z.boolean().default(true),
  tone: z.enum(["friendly", "professional", "concise"]).default("friendly"),
});
export const campaignUpdateSchema = campaignCreateSchema.partial();
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const RUN_STAGES = ["discover", "audit", "enrich", "score", "draft"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export interface RunCounts {
  discovered: number;
  new: number;
  duplicates: number;
  audited: number;
  qualified: number;
  drafted: number;
  sent: number;
  failed: number;
}
export const EMPTY_COUNTS: RunCounts = {
  discovered: 0,
  new: 0,
  duplicates: 0,
  audited: 0,
  qualified: 0,
  drafted: 0,
  sent: 0,
  failed: 0,
};
