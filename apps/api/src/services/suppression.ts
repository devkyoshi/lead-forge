import { normalizeEmail } from "@leadforge/shared";
import { prisma } from "../db.js";

/** True if the address or its domain is on the workspace suppression list. */
export async function isSuppressed(workspaceId: string, email: string): Promise<boolean> {
  const e = normalizeEmail(email);
  const domain = e.split("@")[1] ?? "";
  const hit = await prisma.suppression.findFirst({
    where: { workspaceId, value: { in: [e, domain].filter(Boolean) } },
    select: { id: true },
  });
  return !!hit;
}
