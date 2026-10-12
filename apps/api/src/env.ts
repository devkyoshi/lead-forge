import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CREDENTIALS_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "CREDENTIALS_KEY must be 32 bytes of hex"),
  PLACES_PROVIDER: z.enum(["mock", "google"]).default("mock"),
  EMAIL_PROVIDER: z.enum(["console", "sendgrid"]).default("console"),
  AI_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const env = parsed.data;
if (env.PLACES_PROVIDER === "google" && !env.GOOGLE_PLACES_API_KEY) {
  console.error("GOOGLE_PLACES_API_KEY is required when PLACES_PROVIDER=google");
  process.exit(1);
}
if (env.EMAIL_PROVIDER === "sendgrid" && !env.SENDGRID_API_KEY) {
  console.error("SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid");
  process.exit(1);
}
if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic");
  process.exit(1);
}
export { env };
