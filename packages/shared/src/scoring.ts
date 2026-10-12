import { z } from "zod";

export const scoringWeightsSchema = z.object({
  noWebsite: z.number().min(0).default(40),
  socialOnly: z.number().min(0).default(32),
  broken: z.number().min(0).default(30),
  poorWebsite: z.number().min(0).default(22),
  rating: z.number().min(0).default(15),
  reviews: z.number().min(0).default(15),
  categoryFit: z.number().min(0).default(10),
});
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;
export const DEFAULT_WEIGHTS: ScoringWeights = scoringWeightsSchema.parse({});

export interface ScoreInput {
  websiteStatus: "NO_WEBSITE" | "SOCIAL_ONLY" | "BROKEN" | "POOR" | "OK" | "UNKNOWN";
  websiteScore?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  category?: string | null;
  /** Categories the campaign targets; a match earns the categoryFit points. */
  targetCategories?: string[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreComponent[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Explainable lead score, 0-100 (weights are normalised so they need not sum to 100).
 * Opportunity (website gap) dominates; rating/reviews signal a business that can pay.
 */
export function scoreLead(input: ScoreInput, weights: ScoringWeights = DEFAULT_WEIGHTS): ScoreResult {
  const parts: ScoreComponent[] = [];

  const maxWebsite = Math.max(weights.noWebsite, weights.socialOnly, weights.broken, weights.poorWebsite);
  let sitePts = 0;
  let siteDetail = "Website looks fine";
  switch (input.websiteStatus) {
    case "NO_WEBSITE":
      sitePts = weights.noWebsite;
      siteDetail = "No website listed";
      break;
    case "SOCIAL_ONLY":
      sitePts = weights.socialOnly;
      siteDetail = "Only a social media page";
      break;
    case "BROKEN":
      sitePts = weights.broken;
      siteDetail = "Website is unreachable or broken";
      break;
    case "POOR": {
      const quality = clamp((input.websiteScore ?? 50) / 100, 0, 1);
      sitePts = Math.round(weights.poorWebsite * (1 - quality) * 1.5);
      sitePts = Math.min(sitePts, weights.poorWebsite);
      siteDetail = `Poor website (audit score ${input.websiteScore ?? "n/a"})`;
      break;
    }
    case "UNKNOWN":
      siteDetail = "Website not audited yet";
      break;
  }
  parts.push({ key: "website", label: "Website gap", points: sitePts, max: maxWebsite, detail: siteDetail });

  const rating = input.rating ?? 0;
  const ratingPts = Math.round(weights.rating * clamp((rating - 3) / 2, 0, 1));
  parts.push({
    key: "rating",
    label: "Rating",
    points: ratingPts,
    max: weights.rating,
    detail: input.rating != null ? `${rating} stars` : "No rating",
  });

  const reviews = input.reviewCount ?? 0;
  const reviewPts = Math.round(weights.reviews * clamp(Math.log10(reviews + 1) / Math.log10(301), 0, 1));
  parts.push({
    key: "reviews",
    label: "Review volume",
    points: reviewPts,
    max: weights.reviews,
    detail: `${reviews} reviews`,
  });

  const targets = (input.targetCategories ?? []).map((c) => c.toLowerCase());
  const fits = !!input.category && targets.some((t) => input.category!.toLowerCase().includes(t));
  parts.push({
    key: "categoryFit",
    label: "Category fit",
    points: fits ? weights.categoryFit : 0,
    max: weights.categoryFit,
    detail: fits ? `Matches target category (${input.category})` : "Not a target category",
  });

  const max = maxWebsite + weights.rating + weights.reviews + weights.categoryFit;
  const total = parts.reduce((s, p) => s + p.points, 0);
  return { score: max > 0 ? clamp(Math.round((total / max) * 100), 0, 100) : 0, breakdown: parts };
}
