import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../env.js";

const key = () => Buffer.from(env.CREDENTIALS_KEY, "hex");

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export const CREDENTIAL_PROVIDERS = ["GOOGLE_PLACES", "SENDGRID", "ANTHROPIC"] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

const ENV_FALLBACK: Record<CredentialProvider, string | undefined> = {
  GOOGLE_PLACES: env.GOOGLE_PLACES_API_KEY,
  SENDGRID: env.SENDGRID_API_KEY,
  ANTHROPIC: env.ANTHROPIC_API_KEY,
};

/** Workspace-stored key first, then the environment. Never log the result. */
export async function resolveSecret(workspaceId: string, provider: CredentialProvider): Promise<string | undefined> {
  const row = await prisma.providerCredential.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  if (row) return decryptSecret(row.encryptedValue);
  return ENV_FALLBACK[provider] || undefined;
}
