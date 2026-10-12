import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { ensureDefaultTemplates } from "../src/services/drafts.js";
import { DEFAULT_CHECKLIST, normalizeAddress, normalizeName, normalizePhone } from "@leadforge/shared";

const prisma = new PrismaClient();

const DEMO_LEADS = [
  { name: "Sunrise Boutique Hotel", address: "12 Lake Rd, Pune", phone: "+91 98765 43210", category: "hotel", rating: 4.6, reviewCount: 212, websiteStatus: "NO_WEBSITE", score: 88 },
  { name: "Spice Route Restaurant", address: "44 MG Road, Pune", phone: "+91 98220 11122", category: "restaurant", rating: 4.3, reviewCount: 540, websiteStatus: "POOR", score: 74 },
  { name: "Glow Salon & Spa", address: "7 Baner Rd, Pune", phone: "+91 90000 55511", category: "salon", rating: 4.8, reviewCount: 96, websiteStatus: "SOCIAL_ONLY", score: 81 },
  { name: "CityCare Clinic", address: "98 FC Road, Pune", phone: "+91 98111 22233", category: "clinic", rating: 4.1, reviewCount: 61, websiteStatus: "BROKEN", score: 69 },
] as const;

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: "admin@leadforge.local" } });
  if (existing) {
    await prisma.workspace.updateMany({ where: { id: existing.workspaceId, portfolioLink: null }, data: { portfolioLink: "https://example.com/portfolio" } });
    await ensureDefaultTemplates(existing.workspaceId);
    console.log("Seed already applied (default templates ensured).");
    return;
  }
  const ws = await prisma.workspace.create({
    data: {
      name: "Demo Workspace",
      senderName: "Alex",
      senderCompany: "Your Studio",
      senderAddress: "123 Example Street, City, Country",
      portfolioLink: "https://example.com/portfolio",
      timezone: "Asia/Kolkata",
    },
  });
  await prisma.user.create({
    data: {
      workspaceId: ws.id,
      email: "admin@leadforge.local",
      name: "Admin",
      passwordHash: await argon2.hash("changeme123"),
      role: "OWNER",
    },
  });
  await prisma.scoringConfig.create({
    data: {
      workspaceId: ws.id,
      weights: { noWebsite: 40, socialOnly: 32, broken: 30, poorWebsite: 22, rating: 15, reviews: 15, categoryFit: 10 },
      qualifyThreshold: 50,
      autoQueueThreshold: 70,
    },
  });
  await ensureDefaultTemplates(ws.id);
  for (const l of DEMO_LEADS) {
    const lead = await prisma.lead.create({
      data: {
        workspaceId: ws.id,
        name: l.name,
        normalizedName: normalizeName(l.name),
        address: l.address,
        normalizedAddress: normalizeAddress(l.address),
        phone: l.phone,
        normalizedPhone: normalizePhone(l.phone),
        category: l.category,
        area: "Pune",
        rating: l.rating,
        reviewCount: l.reviewCount,
        websiteStatus: l.websiteStatus,
        score: l.score,
        status: l.score >= 70 ? "QUALIFIED" : "NEW",
        source: "seed",
        sourcePlaceId: normalizeName(l.name),
      },
    });
    await prisma.leadChecklistItem.createMany({
      data: DEFAULT_CHECKLIST.map((c, i) => ({ workspaceId: ws.id, leadId: lead.id, key: c.key, label: c.label, position: i })),
    });
    await prisma.leadStatusHistory.create({
      data: { workspaceId: ws.id, leadId: lead.id, toStatus: lead.status, actor: "system", reason: "Seeded" },
    });
  }
  console.log("Seeded. Login: admin@leadforge.local / changeme123");
}

main().finally(() => prisma.$disconnect());
