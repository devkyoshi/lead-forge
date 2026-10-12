import type { Area } from "@leadforge/shared";
import { env } from "../env.js";
import { GooglePlacesProvider } from "./places-google.js";
import { MockPlacesProvider } from "./places-mock.js";

export interface PlaceResult {
  sourcePlaceId: string;
  name: string;
  address?: string;
  phone?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  lat?: number;
  lng?: number;
  websiteUrl?: string;
  email?: string;
}

export interface PlacesSearchParams {
  area: Area;
  category: string;
  limit?: number;
}

/** Discovery provider. Implementations must use official APIs only (no HTML scraping). */
export interface PlacesProvider {
  readonly name: string;
  search(params: PlacesSearchParams): Promise<PlaceResult[]>;
}

export function createPlacesProvider(): PlacesProvider {
  return env.PLACES_PROVIDER === "google"
    ? new GooglePlacesProvider(env.GOOGLE_PLACES_API_KEY!)
    : new MockPlacesProvider();
}
