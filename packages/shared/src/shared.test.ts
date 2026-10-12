import { describe, expect, it } from "vitest";
import {
  analyzeHtml,
  canTransition,
  normalizeName,
  normalizePhone,
  robotsAllows,
  scoreLead,
  validateTransition,
} from "./index";

describe("scoreLead", () => {
  it("ranks no website above poor website above ok website for the same business", () => {
    const base = { rating: 4.6, reviewCount: 200, category: "hotel", targetCategories: ["hotel"] };
    const none = scoreLead({ ...base, websiteStatus: "NO_WEBSITE" }).score;
    const poor = scoreLead({ ...base, websiteStatus: "POOR", websiteScore: 30 }).score;
    const ok = scoreLead({ ...base, websiteStatus: "OK", websiteScore: 90 }).score;
    expect(none).toBeGreaterThan(poor);
    expect(poor).toBeGreaterThan(ok);
  });

  it("explains every point in the breakdown", () => {
    const r = scoreLead({ websiteStatus: "NO_WEBSITE", rating: 5, reviewCount: 300, category: "salon", targetCategories: ["salon"] });
    expect(r.score).toBe(100);
    expect(r.breakdown.map((b) => b.key)).toEqual(["website", "rating", "reviews", "categoryFit"]);
  });

  it("honours custom weights", () => {
    const heavy = scoreLead({ websiteStatus: "NO_WEBSITE" }, { noWebsite: 100, socialOnly: 0, broken: 0, poorWebsite: 0, rating: 0, reviews: 0, categoryFit: 0 });
    expect(heavy.score).toBe(100);
  });
});

describe("analyzeHtml", () => {
  const good = `<html><head><title>Cafe Bloom</title><meta name="viewport" content="width=device-width"><meta name="description" content="x"></head><body>${"<p>content</p>".repeat(200)}<form></form>© 2026 <a href="mailto:hi@cafebloom.com">mail</a></body></html>`;
  const poor = `<html><body><img src="x.wixstatic.com/a.png">© 2012 old site</body></html>`;

  it("scores a modern page highly and extracts mailto emails", () => {
    const r = analyzeHtml({ url: "https://cafebloom.com", html: good, responseMs: 300, year: 2026 });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.emails[0]).toEqual({ value: "hi@cafebloom.com", confidence: 0.9 });
  });

  it("flags issues on an outdated page", () => {
    const r = analyzeHtml({ url: "http://old.example.org", html: poor, responseMs: 4000, year: 2026 });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["NO_HTTPS", "NO_VIEWPORT", "VERY_SLOW", "OUTDATED", "BUILDER_TEMPLATE"]));
    expect(r.score).toBeLessThan(40);
  });
});

describe("robotsAllows", () => {
  const txt = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: LeadForgeBot\nDisallow: /nope";
  it("applies the most specific group and longest match", () => {
    expect(robotsAllows(txt, "OtherBot", "/private/x")).toBe(false);
    expect(robotsAllows(txt, "OtherBot", "/private/ok")).toBe(true);
    expect(robotsAllows(txt, "LeadForgeBot/1.0", "/nope/a")).toBe(false);
    expect(robotsAllows(txt, "LeadForgeBot/1.0", "/private/x")).toBe(true);
  });
});

describe("normalization (dedupe keys)", () => {
  it("matches differently formatted names and phones", () => {
    expect(normalizeName("The Sunrise Boutique Hotel Pvt. Ltd.")).toBe(normalizeName("Sunrise Boutique"));
    expect(normalizePhone("+91 98765-43210")).toBe(normalizePhone("098765 43210"));
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("status transitions", () => {
  it("allows pipeline moves and blocks leaving UNSUBSCRIBED", () => {
    expect(canTransition("NEW", "CONTACTED")).toBe(true);
    expect(canTransition("UNSUBSCRIBED", "NEW")).toBe(false);
    expect(canTransition("LOST", "NEW")).toBe(true);
    expect(canTransition("LOST", "CONTACTED")).toBe(false);
  });
  it("requires reason and project details", () => {
    expect(validateTransition("NEW", "LOST")).toMatch(/reason/i);
    expect(validateTransition("NEGOTIATING", "CONFIRMED")).toMatch(/project/i);
    expect(validateTransition("NEGOTIATING", "CONFIRMED", { project: { name: "Site" } })).toBeNull();
  });
});

import { markdownToHtml, renderTemplate, validateAiSentences } from "./index";

describe("renderTemplate", () => {
  it("substitutes variables, uses fallbacks and reports missing ones", () => {
    const r = renderTemplate("Hi {{owner_name|there}}, {{business_name}} in {{area}} {{nope}}", { business_name: "Cafe Bloom", area: "Pune" });
    expect(r.text).toBe("Hi there, Cafe Bloom in Pune");
    expect(r.used.owner_name).toBe("there");
    expect(r.missing).toEqual(["nope"]);
  });
  it("collapses blank lines left by empty variables", () => {
    expect(renderTemplate("a\n\n{{ai_note}}\n\nb", {}).text).toBe("a\n\nb");
  });
});

describe("markdownToHtml", () => {
  it("escapes html and renders links and lists", () => {
    const html = markdownToHtml("Hi <script>x</script> [go](https://a.com)\n\n- one\n- two");
    expect(html).not.toContain("<script>");
    expect(html).toContain('<a href="https://a.com">go</a>');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });
});

describe("validateAiSentences", () => {
  const facts = "Cafe Bloom rated 4.6 with 212 reviews";
  it("accepts sentences that only use supplied numbers", () => {
    expect(validateAiSentences(["With 212 reviews you clearly have happy guests."], facts).ok).toBe(true);
  });
  it("rejects invented numbers, links and prices", () => {
    expect(validateAiSentences(["You have 500 reviews."], facts).ok).toBe(false);
    expect(validateAiSentences(["See www.x.com"], facts).ok).toBe(false);
    expect(validateAiSentences(["Only $99 per month."], facts).ok).toBe(false);
  });
});
