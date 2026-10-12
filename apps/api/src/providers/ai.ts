import Anthropic from "@anthropic-ai/sdk";
import { aiNoteSchema, type Tone } from "@leadforge/shared";
import { env } from "../env.js";

export interface PersonalizeInput {
  tone: Tone;
  facts: {
    businessName: string;
    category?: string | null;
    area?: string | null;
    rating?: number | null;
    reviewCount?: number | null;
    websiteStatus: string;
    websiteIssues: string[];
  };
  /** Human-readable fact sheet; the only source the AI may draw on. */
  factSheet: string;
}

export interface AiProvider {
  readonly name: string;
  /** Returns 1-2 tailored sentences, or throws. Callers validate and fall back. */
  personalize(input: PersonalizeInput): Promise<string[]>;
}

/** Deterministic, fact-only sentences. Used by the mock provider and as the fallback when AI output is rejected. */
export function factBasedNote(f: PersonalizeInput["facts"]): string[] {
  const parts: string[] = [];
  if (f.rating && f.reviewCount && f.rating >= 4) {
    parts.push(`With a ${f.rating} rating from ${f.reviewCount} reviews, it is clear your customers value what you do.`);
  } else if (f.reviewCount) {
    parts.push(`With ${f.reviewCount} reviews, people are clearly already finding you.`);
  }
  if (f.websiteStatus === "NO_WEBSITE") parts.push("A simple website would let them find your details in seconds.");
  else if (f.websiteStatus === "SOCIAL_ONLY") parts.push("A website of your own would give customers more than a social media page can.");
  else if (f.websiteIssues.length) parts.push("A few small fixes would make the site work much better on phones.");
  return parts.slice(0, 2);
}

class MockAiProvider implements AiProvider {
  readonly name = "mock";
  async personalize(input: PersonalizeInput) {
    return factBasedNote(input.facts);
  }
}

const TONE_GUIDE: Record<Tone, string> = {
  friendly: "warm, relaxed and personable",
  professional: "polished, respectful and businesslike",
  concise: "brief and direct, no filler",
};

class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic";
  private client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  async personalize({ tone, factSheet }: PersonalizeInput) {
    const response = await this.client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 600,
      system:
        "You write one short personalised paragraph for a cold outreach email from a web designer to a local business. " +
        "Use ONLY the facts in the fact sheet. Never invent facts, numbers, names, prices, awards or claims, and never mention links or email addresses. " +
        "If a fact is not in the sheet, do not mention it. Reply with JSON only, in the form {\"sentences\": [\"...\"]} with one or two sentences.",
      messages: [
        {
          role: "user",
          content: `Tone: ${TONE_GUIDE[tone]}.\n\nFact sheet:\n${factSheet}\n\nWrite the 1-2 sentences now.`,
        },
      ],
    });
    if (response.stop_reason === "refusal") throw new Error("model refused");
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (!json) throw new Error("no JSON in model output");
    return aiNoteSchema.parse(JSON.parse(json)).sentences;
  }
}

export function createAiProvider(): AiProvider {
  return env.AI_PROVIDER === "anthropic" ? new AnthropicAiProvider() : new MockAiProvider();
}
