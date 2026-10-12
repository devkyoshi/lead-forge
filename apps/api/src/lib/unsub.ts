import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

const sign = (payload: string) => createHmac("sha256", env.JWT_SECRET).update(`unsub:${payload}`).digest("base64url");

/** Signed, non-guessable unsubscribe token for one lead. */
export function createUnsubToken(workspaceId: string, leadId: string): string {
  const payload = Buffer.from(`${workspaceId}.${leadId}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubToken(token: string): { workspaceId: string; leadId: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [workspaceId, leadId] = Buffer.from(payload, "base64url").toString().split(".");
  return workspaceId && leadId ? { workspaceId, leadId } : null;
}

export const unsubscribeUrl = (workspaceId: string, leadId: string) =>
  `${env.API_PUBLIC_URL}/u/${createUnsubToken(workspaceId, leadId)}`;

/** Shared secret in the inbound-parse webhook URL, so only the mail provider can post replies. */
export const inboundKey = () => createHmac("sha256", env.JWT_SECRET).update("inbound-webhook").digest("hex").slice(0, 32);
