import { extractEmails, isSocialUrl } from "@leadforge/shared";
import { politeFetch } from "../lib/fetcher.js";

export interface EnrichmentCandidate {
  websiteUrl: string | null;
  websiteStatus: string;
}

export interface FoundEmail {
  value: string;
  confidence: number;
  source: string;
}

/**
 * Finds public contact emails for a business. Implementations may only use data the business
 * itself publishes (its own site) or an official data provider.
 */
export interface EnrichmentProvider {
  readonly name: string;
  findEmails(lead: EnrichmentCandidate): Promise<FoundEmail[]>;
}

/** Looks for mailto links and addresses on the business's own contact pages. Respects robots.txt via politeFetch. */
export class WebsiteEnrichmentProvider implements EnrichmentProvider {
  readonly name = "website";

  async findEmails(lead: EnrichmentCandidate): Promise<FoundEmail[]> {
    if (!lead.websiteUrl || isSocialUrl(lead.websiteUrl) || lead.websiteStatus === "BROKEN") return [];
    const base = lead.websiteUrl.endsWith("/") ? lead.websiteUrl : `${lead.websiteUrl}/`;
    for (const path of ["contact", "contact-us"]) {
      const res = await politeFetch(new URL(path, base).toString());
      if (!res.ok) continue;
      const emails = extractEmails(res.html);
      if (emails.length) return emails.map((e) => ({ ...e, source: "website-contact-page" }));
    }
    return [];
  }
}

export function createEnrichmentProvider(): EnrichmentProvider {
  return new WebsiteEnrichmentProvider();
}
