import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { normalizeEmail } from "@leadforge/shared";
import { prisma } from "../db.js";
import { CREDENTIAL_PROVIDERS, encryptSecret } from "../lib/secrets.js";
import { inboundKey } from "../lib/unsub.js";
import { env } from "../env.js";
import { HttpError } from "../services/leads.js";

const settingsBody = z
  .object({
    name: z.string().min(1).max(120),
    senderName: z.string().max(120).nullable(),
    senderCompany: z.string().max(120).nullable(),
    senderAddress: z.string().max(300).nullable(),
    fromEmail: z.string().email().nullable(),
    replyTo: z.string().email().nullable(),
    portfolioLink: z.string().url().nullable(),
    timezone: z.string().max(64).refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone"),
    sendWindowStart: z.number().int().min(0).max(23),
    sendWindowEnd: z.number().int().min(0).max(24),
    dailyLimit: z.number().int().min(1).max(5000),
    hourlyLimit: z.number().int().min(1).max(1000),
    warmupEnabled: z.boolean(),
    jurisdictionNotes: z.string().max(5000).nullable(),
  })
  .partial();

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  r.get("/settings", { ...auth, schema: { tags: ["settings"] } }, async (req) => {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: req.auth.workspaceId } });
    const { apiKeyHash: _h, ...safe } = ws;
    return {
      ...safe,
      inboundWebhookUrl: `${env.API_PUBLIC_URL}/webhooks/sendgrid/inbound?key=${inboundKey()}`,
      eventWebhookUrl: `${env.API_PUBLIC_URL}/webhooks/sendgrid/events`,
      emailProvider: env.EMAIL_PROVIDER,
      aiProvider: env.AI_PROVIDER,
      placesProvider: env.PLACES_PROVIDER,
    };
  });

  r.patch("/settings", { ...auth, schema: { body: settingsBody, tags: ["settings"] } }, async (req) => {
    const current = await prisma.workspace.findUniqueOrThrow({ where: { id: req.auth.workspaceId } });
    const data: Record<string, unknown> = { ...req.body };
    // Warm-up day 0 is the day it is switched on.
    if (req.body.warmupEnabled === true && !current.warmupEnabled) data.warmupStartedAt = new Date();
    if (req.body.warmupEnabled === false) data.warmupStartedAt = null;
    return prisma.workspace.update({ where: { id: current.id }, data });
  });

  r.get("/settings/checklist", { ...auth, schema: { tags: ["settings"] } }, async (req) => {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: req.auth.workspaceId }, select: { checklistDefaults: true } });
    return { items: ws.checklistDefaults ?? null };
  });

  r.put(
    "/settings/checklist",
    {
      ...auth,
      schema: {
        body: z.object({ items: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]+$/), label: z.string().min(1).max(80) })).min(1).max(20) }),
        tags: ["settings"],
      },
    },
    async (req) => {
      await prisma.workspace.update({ where: { id: req.auth.workspaceId }, data: { checklistDefaults: req.body.items } });
      return { ok: true };
    },
  );

  // ---- Provider credentials: write-only, encrypted at rest ----
  r.get("/settings/credentials", { ...auth, schema: { tags: ["settings"] } }, async (req) => {
    const rows = await prisma.providerCredential.findMany({ where: { workspaceId: req.auth.workspaceId }, select: { provider: true, updatedAt: true } });
    return { items: CREDENTIAL_PROVIDERS.map((p) => ({ provider: p, configured: rows.some((x) => x.provider === p), updatedAt: rows.find((x) => x.provider === p)?.updatedAt ?? null })) };
  });

  const providerParam = z.object({ provider: z.enum(CREDENTIAL_PROVIDERS) });
  r.put(
    "/settings/credentials/:provider",
    { ...auth, schema: { params: providerParam, body: z.object({ value: z.string().min(8).max(500) }), tags: ["settings"] } },
    async (req) => {
      const encryptedValue = encryptSecret(req.body.value.trim());
      await prisma.providerCredential.upsert({
        where: { workspaceId_provider: { workspaceId: req.auth.workspaceId, provider: req.params.provider } },
        create: { workspaceId: req.auth.workspaceId, provider: req.params.provider, encryptedValue },
        update: { encryptedValue },
      });
      return { ok: true };
    },
  );
  r.delete("/settings/credentials/:provider", { ...auth, schema: { params: providerParam, tags: ["settings"] } }, async (req) => {
    await prisma.providerCredential.deleteMany({ where: { workspaceId: req.auth.workspaceId, provider: req.params.provider } });
    return { ok: true };
  });

  // ---- Suppression list ----
  r.get("/suppression", { ...auth, schema: { tags: ["suppression"] } }, async (req) => ({
    items: await prisma.suppression.findMany({ where: { workspaceId: req.auth.workspaceId }, orderBy: { createdAt: "desc" }, take: 1000 }),
  }));

  r.post(
    "/suppression",
    { ...auth, schema: { body: z.object({ values: z.array(z.string().min(3).max(200)).min(1).max(5000) }), tags: ["suppression"] } },
    async (req) => {
      let added = 0;
      for (const raw of req.body.values) {
        const value = normalizeEmail(raw.replace(/^@/, ""));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/^[^\s@]+\.[^\s@]+$/.test(value)) continue; // email or domain
        const res = await prisma.suppression.upsert({
          where: { workspaceId_value: { workspaceId: req.auth.workspaceId, value } },
          create: { workspaceId: req.auth.workspaceId, value, reason: "MANUAL", source: req.auth.userId },
          update: {},
        });
        if (res) added++;
      }
      return { added };
    },
  );

  r.delete("/suppression/:id", { ...auth, schema: { params: z.object({ id: z.string() }), tags: ["suppression"] } }, async (req) => {
    const row = await prisma.suppression.findFirst({ where: { id: req.params.id, workspaceId: req.auth.workspaceId } });
    if (!row) throw new HttpError(404, "Not found");
    await prisma.suppression.delete({ where: { id: row.id } });
    return { ok: true };
  });
};
