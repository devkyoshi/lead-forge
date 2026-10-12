import { createHash } from "node:crypto";
import { env } from "../env.js";
import type { PlaceResult, PlacesProvider, PlacesSearchParams } from "./places.js";

const NAMES = [
  "Sunrise", "Lotus", "Blue Orchid", "Golden Palm", "Maple Leaf", "Harbor View", "Spice Route", "Green Valley",
  "Royal Crown", "Silver Oak",
];
const KINDS: Record<string, string> = {
  hotel: "Boutique Hotel",
  restaurant: "Kitchen",
  salon: "Salon & Spa",
  clinic: "Family Clinic",
  shop: "Store",
};
// Deterministic website situation per slot: gives every audit outcome in a mock run.
const SITE_KINDS = ["none", "social", "good", "poor", "broken"] as const;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hash = (s: string) => createHash("sha1").update(s).digest("hex");

/**
 * Deterministic fake discovery. Websites point at this API's /mock-sites routes so audits
 * work offline. The last result of each category repeats the first business under a new
 * place id and phone format, to exercise dedupe.
 */
export class MockPlacesProvider implements PlacesProvider {
  readonly name = "mock";

  async search({ area, category, limit = 9 }: PlacesSearchParams): Promise<PlaceResult[]> {
    const cat = category.toLowerCase();
    const kind = KINDS[cat] ?? `${category[0]!.toUpperCase()}${category.slice(1)}`;
    const base = hash(`${area.label}|${cat}`).slice(0, 4);
    const count = Math.min(limit, NAMES.length - 1);
    const out: PlaceResult[] = [];
    for (let i = 0; i < count; i++) {
      const name = `${NAMES[i]} ${kind}`;
      const slug = slugify(name);
      const siteKind = SITE_KINDS[i % SITE_KINDS.length]!;
      const num = 10 + i * 7;
      const phoneBody = (9000000000 + parseInt(hash(`${area.label}${cat}${i}`).slice(0, 7), 16) % 99999999).toString();
      out.push({
        sourcePlaceId: `mock:${base}:${cat}:${i}`,
        name,
        address: `${num} Main Street, ${area.label}`,
        phone: `+91 ${phoneBody.slice(0, 5)} ${phoneBody.slice(5, 10)}`,
        category: cat,
        rating: Math.round((3.4 + ((i * 37) % 16) / 10) * 10) / 10,
        reviewCount: 8 + ((i * 53) % 400),
        lat: area.type === "radius" ? area.lat + i * 0.001 : 18.52 + i * 0.001,
        lng: area.type === "radius" ? area.lng + i * 0.001 : 73.85 + i * 0.001,
        websiteUrl:
          siteKind === "none"
            ? undefined
            : siteKind === "social"
              ? `https://www.facebook.com/${slug}`
              : siteKind === "broken"
                ? "http://localhost:9/"
                : `${env.API_PUBLIC_URL}/mock-sites/${siteKind}/${slug}`,
      });
    }
    // Duplicate of the first business under a different place id.
    const first = out[0]!;
    out.push({
      ...first,
      sourcePlaceId: `mock:${base}:${cat}:dup`,
      name: `The ${first.name}`,
      phone: first.phone?.replace(/\s/g, "-"),
    });
    return out;
  }
}
