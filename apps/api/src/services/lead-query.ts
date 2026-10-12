import type { Prisma } from "@prisma/client";
import type { LeadListQuery } from "@leadforge/shared";

/** The lead-list filters, shared by the table, the CSV export and bulk actions so they always agree. */
export function buildLeadWhere(workspaceId: string, q: Partial<LeadListQuery>): Prisma.LeadWhereInput {
  return {
    workspaceId,
    deletedAt: null,
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.websiteStatus ? { websiteStatus: q.websiteStatus } : {}),
    ...(q.category ? { category: { equals: q.category, mode: "insensitive" } } : {}),
    ...(q.area ? { area: { equals: q.area, mode: "insensitive" } } : {}),
    ...(q.tag ? { tags: { has: q.tag } } : {}),
    ...(q.campaignId ? { campaignId: q.campaignId } : {}),
    ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: "insensitive" } },
            { address: { contains: q.q, mode: "insensitive" } },
            { phone: { contains: q.q } },
          ],
        }
      : {}),
  };
}

/** RFC 4180 field escaping, plus a leading quote on values a spreadsheet would execute as a formula. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
