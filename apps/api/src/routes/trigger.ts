import { createHash, randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Redis } from "ioredis";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { HttpError } from "../services/leads.js";
import { startRun } from "../services/runs.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
let redis: Redis | null = null;
const getRedis = () => (redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }));

/** Workspace API key management (session auth) and the key-authenticated "run a campaign" endpoint. */
export const triggerRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // The plaintext key is shown once; only its hash is stored.
  r.post("/settings/api-key", { preHandler: app.authenticate, schema: { tags: ["settings"] } }, async (req) => {
    const key = `lf_${randomBytes(24).toString("base64url")}`;
    await prisma.workspace.update({ where: { id: req.auth.workspaceId }, data: { apiKeyHash: sha256(key) } });
    return { apiKey: key };
  });

  r.delete("/settings/api-key", { preHandler: app.authenticate, schema: { tags: ["settings"] } }, async (req) => {
    await prisma.workspace.update({ where: { id: req.auth.workspaceId }, data: { apiKeyHash: null } });
    return { ok: true };
  });

  /**
   * Starts a campaign run from automation. Auth: `x-api-key`. Optional `Idempotency-Key` header:
   * repeating the same key within 24h returns the original run instead of starting another.
   */
  r.post(
    "/trigger/campaigns/:id/run",
    { schema: { params: z.object({ id: z.string().min(1) }), tags: ["trigger"] } },
    async (req, reply) => {
      const key = req.headers["x-api-key"];
      if (typeof key !== "string" || !key) throw new HttpError(401, "Missing x-api-key header");
      const ws = await prisma.workspace.findFirst({ where: { apiKeyHash: sha256(key) }, select: { id: true } });
      if (!ws) throw new HttpError(401, "Invalid API key");
      const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, workspaceId: ws.id } });
      if (!campaign) throw new HttpError(404, "Campaign not found");
      if (campaign.status !== "ACTIVE") throw new HttpError(409, `Campaign is ${campaign.status.toLowerCase()}`);

      const idem = req.headers["idempotency-key"];
      const idemKey = typeof idem === "string" && idem ? `idem:${ws.id}:${campaign.id}:${idem.slice(0, 120)}` : null;
      if (idemKey) {
        const existing = await getRedis().get(idemKey);
        if (existing) return reply.status(200).send({ id: existing, idempotentReplay: true });
      }
      const run = await startRun(ws.id, campaign.id, "API");
      if (idemKey) await getRedis().set(idemKey, run.id, "EX", 86_400);
      return reply.status(202).send({ id: run.id, status: run.status });
    },
  );
};
