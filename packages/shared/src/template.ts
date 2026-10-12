import { z } from "zod";

export const TEMPLATE_VARIABLES = [
  { key: "business_name", label: "Business name" },
  { key: "owner_name|there", label: "Owner name (falls back to \"there\")" },
  { key: "category", label: "Category" },
  { key: "area", label: "Area" },
  { key: "website_issues", label: "Website issues found" },
  { key: "ai_note", label: "AI personalised note (1-2 sentences)" },
  { key: "rating", label: "Rating" },
  { key: "review_count", label: "Review count" },
  { key: "sender_name", label: "Sender name" },
  { key: "sender_company", label: "Sender company" },
  { key: "portfolio_link", label: "Portfolio link" },
  { key: "unsubscribe_link", label: "Unsubscribe link" },
] as const;

export const TONES = ["friendly", "professional", "concise"] as const;
export type Tone = (typeof TONES)[number];

export type TemplateVars = Record<string, string | number | null | undefined>;

export interface RenderResult {
  text: string;
  /** Variables that were referenced, with the value substituted. */
  used: Record<string, string>;
  /** Variables referenced in the template that had no value and no fallback. */
  missing: string[];
}

/** Replaces {{name}} and {{name|fallback}}. Unknown/empty variables with no fallback render as empty. */
export function renderTemplate(template: string, vars: TemplateVars): RenderResult {
  const used: Record<string, string> = {};
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi, (_m, name: string, fallback?: string) => {
    const raw = vars[name];
    const has = raw !== undefined && raw !== null && String(raw).trim() !== "";
    const value = has ? String(raw) : (fallback?.trim() ?? "");
    if (!has && fallback === undefined && !missing.includes(name)) missing.push(name);
    used[name] = value;
    return value;
  });
  // Collapse blank paragraphs left behind by empty variables.
  return { text: text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim(), used, missing };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

/** Minimal, safe markdown -> HTML (paragraphs, bullet lists, bold/italic, links). Input is HTML-escaped first. */
export function markdownToHtml(md: string): string {
  const blocks = md.trim().split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`);
    } else {
      out.push(`<p>${lines.map(inline).join("<br>")}</p>`);
    }
  }
  return out.join("\n");
}

// ---- AI output guard -------------------------------------------------------------------

export const aiNoteSchema = z.object({ sentences: z.array(z.string().min(1)).min(1).max(2) });

/**
 * The AI must not invent facts. Accepts its sentences only if they are short, contain no
 * links/emails/prices, and every number in them appears in the supplied lead facts.
 */
export function validateAiSentences(sentences: string[], facts: string): { ok: true; sentences: string[] } | { ok: false; reason: string } {
  if (!sentences.length || sentences.length > 2) return { ok: false, reason: "expected 1-2 sentences" };
  const factNumbers = new Set(facts.match(/\d+(?:[.,]\d+)?/g) ?? []);
  for (const s of sentences) {
    if (s.length > 320) return { ok: false, reason: "sentence too long" };
    if (/https?:\/\/|www\.|@|[$€£₹]/.test(s)) return { ok: false, reason: "contains a link, email or currency" };
    for (const n of s.match(/\d+(?:[.,]\d+)?/g) ?? []) {
      if (!factNumbers.has(n)) return { ok: false, reason: `number ${n} is not in the lead facts` };
    }
  }
  return { ok: true, sentences: sentences.map((s) => s.trim()) };
}

// ---- Default templates -----------------------------------------------------------------

export interface DefaultTemplate {
  name: string;
  category: string;
  scenario: "NO_WEBSITE" | "POOR_WEBSITE" | "FOLLOWUP_1" | "FOLLOWUP_2";
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: "No website - first email",
    category: "generic",
    scenario: "NO_WEBSITE",
    subject: "A simple website for {{business_name}}?",
    body: `Hi {{owner_name|there}},

I came across {{business_name}} while looking at {{category}} businesses in {{area}}. {{website_issues}}

{{ai_note}}

I build clean, fast websites for local businesses, usually live within two weeks: your menu or services, photos, opening hours, a map, and a way for customers to call or book you directly. Here are a few examples of my work: {{portfolio_link}}

Would a quick 10-minute call this week be useful? Or just reply with "send ideas" and I will put together a short mock-up for {{business_name}} at no cost.

Best regards,
{{sender_name}}
{{sender_company}}

If you would rather not hear from me, you can [unsubscribe here]({{unsubscribe_link}}).`,
  },
  {
    name: "Poor website - first email",
    category: "generic",
    scenario: "POOR_WEBSITE",
    subject: "A few quick fixes for the {{business_name}} website",
    body: `Hi {{owner_name|there}},

I was looking at {{business_name}}'s website while researching {{category}} businesses in {{area}}, and noticed a few things that may be costing you customers: {{website_issues}}

{{ai_note}}

These are all fixable, and a refreshed site usually pays for itself quickly through more calls, bookings and enquiries. I would be happy to send a short, no-obligation list of what I would change. Examples of recent projects: {{portfolio_link}}

Shall I send that over?

Best regards,
{{sender_name}}
{{sender_company}}

If you would rather not hear from me, you can [unsubscribe here]({{unsubscribe_link}}).`,
  },
  {
    name: "Follow-up 1 (gentle nudge)",
    category: "generic",
    scenario: "FOLLOWUP_1",
    subject: "Re: {{business_name}} website",
    body: `Hi {{owner_name|there}},

Just following up on my note last week about {{business_name}}. I know things get busy in the {{category}} business, so a one-line reply is plenty: "yes, send ideas" or "not now".

If it helps, you can see what I have built for others here: {{portfolio_link}}

Best regards,
{{sender_name}}
{{sender_company}}

[Unsubscribe]({{unsubscribe_link}})`,
  },
  {
    name: "Follow-up 2 (last note)",
    category: "generic",
    scenario: "FOLLOWUP_2",
    subject: "Last note about {{business_name}}",
    body: `Hi {{owner_name|there}},

This is my last message on this, so I will not clutter your inbox. If improving how {{business_name}} shows up online is ever a priority, just reply and I will gladly put together a free mock-up.

Wishing you a great season in {{area}}.

Best regards,
{{sender_name}}
{{sender_company}}

[Unsubscribe]({{unsubscribe_link}})`,
  },
];
