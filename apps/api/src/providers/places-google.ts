import type { PlaceResult, PlacesProvider, PlacesSearchParams } from "./places.js";

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude: number; longitude: number };
  primaryTypeDisplayName?: { text: string };
}

/** Google Places API (New) Text Search. Official API only. */
export class GooglePlacesProvider implements PlacesProvider {
  readonly name = "google";
  constructor(private apiKey: string) {}

  async search({ area, category, limit = 40 }: PlacesSearchParams): Promise<PlaceResult[]> {
    const results: PlaceResult[] = [];
    let pageToken: string | undefined;
    do {
      const body: Record<string, unknown> = {
        textQuery: area.type === "city" ? `${category} in ${area.query}` : category,
        pageSize: Math.min(20, limit - results.length),
        ...(pageToken ? { pageToken } : {}),
      };
      if (area.type === "radius") {
        body.locationBias = {
          circle: { center: { latitude: area.lat, longitude: area.lng }, radius: Math.min(area.radiusKm * 1000, 50000) },
        };
      }
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": FIELDS,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { places?: GooglePlace[]; nextPageToken?: string };
      for (const p of data.places ?? []) {
        results.push({
          sourcePlaceId: p.id,
          name: p.displayName?.text ?? "Unknown",
          address: p.formattedAddress,
          phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber,
          category: p.primaryTypeDisplayName?.text ?? category,
          rating: p.rating,
          reviewCount: p.userRatingCount,
          lat: p.location?.latitude,
          lng: p.location?.longitude,
          websiteUrl: p.websiteUri,
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken && results.length < limit);
    return results;
  }
}
