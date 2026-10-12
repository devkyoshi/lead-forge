import { z } from "zod";
import { LEAD_STATUSES } from "./status";

export const leadStatusSchema = z.enum(LEAD_STATUSES);

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  workspaceName: z.string().min(1).max(100).optional(),
});
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const websiteStatusSchema = z.enum([
  "NO_WEBSITE",
  "SOCIAL_ONLY",
  "BROKEN",
  "POOR",
  "OK",
  "UNKNOWN",
]);

export const leadCreateSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(400).optional(),
  phone: z.string().max(40).optional(),
  category: z.string().max(80).optional(),
  area: z.string().max(120).optional(),
  websiteUrl: z.string().url().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  email: z.string().email().optional(),
});

export const leadUpdateSchema = leadCreateSchema.partial().extend({
  assignedTo: z.string().nullable().optional(),
});

export const leadListQuerySchema = z.object({
  q: z.string().optional(),
  status: z.array(leadStatusSchema).or(leadStatusSchema.transform((s) => [s])).optional(),
  websiteStatus: websiteStatusSchema.optional(),
  category: z.string().optional(),
  area: z.string().optional(),
  tag: z.string().optional(),
  campaignId: z.string().optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  sort: z.enum(["score", "createdAt", "name", "rating"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const statusChangeSchema = z.object({
  status: leadStatusSchema,
  reason: z.string().max(500).optional(),
  project: z
    .object({
      name: z.string().min(1),
      value: z.number().min(0).optional(),
      notes: z.string().optional(),
      expectedStart: z.string().optional(),
    })
    .optional(),
});

export const noteCreateSchema = z.object({ body: z.string().min(1).max(5000) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;
