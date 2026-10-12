export const SOCIAL_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linktr.ee",
  "linktree.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "wa.me",
  "whatsapp.com",
];

export function isSocialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export interface AuditIssue {
  code: string;
  message: string;
}

export interface HtmlAuditInput {
  url: string;
  finalUrl?: string;
  html: string;
  responseMs: number;
  lastModified?: string | null;
  /** Current year, injectable for tests. */
  year?: number;
}

export interface HtmlAuditResult {
  score: number;
  issues: AuditIssue[];
  checks: Record<string, unknown>;
  emails: { value: string; confidence: number }[];
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const JUNK_EMAIL = /(example\.com|sentry|wixpress|domain\.com|yourname|@2x|\.(png|jpg|jpeg|gif|svg|webp)$)/i;

export function extractEmails(html: string): { value: string; confidence: number }[] {
  const found = new Map<string, number>();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const e = decodeURIComponent(m[1]!).trim().toLowerCase();
    if (!JUNK_EMAIL.test(e)) found.set(e, 0.9);
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (!JUNK_EMAIL.test(e) && !found.has(e)) found.set(e, 0.6);
  }
  return [...found].map(([value, confidence]) => ({ value, confidence }));
}

/** Pure, deterministic heuristic audit of a fetched homepage. Score 0-100 (higher = better site). */
export function analyzeHtml(input: HtmlAuditInput): HtmlAuditResult {
  const { html, responseMs } = input;
  const year = input.year ?? new Date().getFullYear();
  const url = input.finalUrl ?? input.url;
  const lower = html.toLowerCase();
  const issues: AuditIssue[] = [];
  let score = 100;
  const deduct = (n: number, code: string, message: string) => {
    score -= n;
    issues.push({ code, message });
  };

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* ignore */
  }
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const https = url.startsWith("https://");
  if (!https && !isLocal) deduct(15, "NO_HTTPS", "Site is not served over HTTPS");

  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  if (!viewport) deduct(20, "NO_VIEWPORT", "Not mobile-friendly (no viewport meta tag)");

  if (responseMs > 3000) deduct(15, "VERY_SLOW", `Very slow response (${Math.round(responseMs)} ms)`);
  else if (responseMs > 1500) deduct(8, "SLOW", `Slow response (${Math.round(responseMs)} ms)`);

  const copyrightYears = [...html.matchAll(/(?:©|&copy;|copyright)[^0-9<]{0,20}((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?/gi)].map(
    (m) => Number(m[2] ?? m[1]),
  );
  const latestYear = copyrightYears.length ? Math.max(...copyrightYears) : null;
  if (latestYear !== null && latestYear <= year - 3) {
    deduct(12, "OUTDATED", `Looks outdated (copyright ${latestYear})`);
  }

  const hasForm = /<form[\s>]/i.test(html);
  const hasBooking = /(book(ing)?\s*(now|online|a table|a room)|reserve|reservation|order\s*online|add to cart|checkout)/i.test(html);
  if (!hasForm && !hasBooking) deduct(12, "NO_CONTACT_OR_BOOKING", "No contact form, booking or online ordering");

  const builder = /(wix\.com|wixstatic|weebly|godaddysitebuilder|blogspot\.com|wp-content\/themes\/(twenty(ten|eleven|twelve|thirteen|fourteen)))/i.exec(lower);
  if (builder) deduct(8, "BUILDER_TEMPLATE", `Built on a basic template/builder (${builder[1]})`);

  if (!/<title>[^<]{3,}<\/title>/i.test(html)) deduct(5, "NO_TITLE", "Missing page title");
  if (!/<meta[^>]+name=["']description["']/i.test(html)) deduct(5, "NO_META_DESCRIPTION", "Missing meta description");
  if (html.length < 1500) deduct(8, "THIN_CONTENT", "Very little content on the homepage");

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    issues,
    checks: {
      https,
      viewport,
      responseMs: Math.round(responseMs),
      copyrightYear: latestYear,
      hasForm,
      hasBooking,
      builder: builder?.[1] ?? null,
      lastModified: input.lastModified ?? null,
    },
    emails: extractEmails(html),
  };
}

/** Minimal robots.txt evaluation for a given user agent and path. */
export function robotsAllows(robotsTxt: string, userAgent: string, path: string): boolean {
  const ua = userAgent.toLowerCase();
  let current: string[] = [];
  let collecting = false;
  const rules: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let group: (typeof rules)[number] | null = null;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!collecting) {
        current = [];
        group = { agents: current, allow: [], disallow: [] };
        rules.push(group);
      }
      current.push(value.toLowerCase());
      collecting = true;
    } else {
      collecting = false;
      if (!group) continue;
      if (key === "allow") group.allow.push(value);
      if (key === "disallow") group.disallow.push(value);
    }
  }
  const specific = rules.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const applicable = specific.length ? specific : rules.filter((g) => g.agents.includes("*"));
  let best = { len: -1, allowed: true };
  for (const g of applicable) {
    for (const d of g.disallow) {
      if (d && path.startsWith(d) && d.length > best.len) best = { len: d.length, allowed: false };
    }
    for (const a of g.allow) {
      if (a && path.startsWith(a) && a.length >= best.len) best = { len: a.length, allowed: true };
    }
  }
  return best.allowed;
}
