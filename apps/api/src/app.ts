import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { env } from "./env.js";
import { COOKIE_NAME } from "./constants.js";
import { prisma } from "./db.js";
import { HttpError } from "./services/leads.js";
import { authRoutes } from "./routes/auth.js";
import { leadRoutes } from "./routes/leads.js";
import { leadBulkRoutes } from "./routes/leads-bulk.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { mockSiteRoutes } from "./routes/mock-sites.js";
import { templateRoutes } from "./routes/templates.js";
import { draftRoutes } from "./routes/drafts.js";
import { settingsRoutes } from "./routes/settings.js";
import { sendingRoutes } from "./routes/sending.js";
import { publicRoutes } from "./routes/public.js";
import { pipelineRoutes } from "./routes/pipeline.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { triggerRoutes } from "./routes/trigger.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    auth: { userId: string; workspaceId: string };
  }
  interface FastifyInstance {
    authenticate: (req: import("fastify").FastifyRequest) => Promise<void>;
  }
}



export async function buildApp() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === "test" ? "silent" : "info" },
    genReqId: (req) => (req.headers["x-request-id"] as string) ?? randomUUID(),
    requestIdHeader: "x-request-id",
    routerOptions: { maxParamLength: 500 }, // signed unsubscribe tokens are ~130 chars
  }).withTypeProvider<ZodTypeProvider>();

  // Accept an empty body with a JSON content type (action endpoints like POST /run take no payload).
  // The raw body is kept because webhook signatures are computed over the exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(Object.assign(e as Error, { statusCode: 400 }), undefined);
    }
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: env.WEB_PUBLIC_URL, credentials: true });
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: COOKIE_NAME, signed: false },
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "LeadForge API",
        version: "0.1.0",
        description:
          "Local-business lead generation and outreach. Sign in with POST /api/v1/auth/login (session cookie), or use an automation API key (x-api-key) for the trigger endpoint. All data is scoped to the signed-in workspace.",
      },
      servers: [{ url: env.API_PUBLIC_URL }],
      tags: [
        { name: "auth", description: "Sign in, sign out and the current user" },
        { name: "leads", description: "Leads, notes, checklist, timeline, bulk actions and CSV export" },
        { name: "campaigns", description: "Campaign definitions, schedules and run control" },
        { name: "runs", description: "Campaign run progress, cancel and resume" },
        { name: "templates", description: "Email templates, versions, preview and test send" },
        { name: "drafts", description: "Drafted emails and the approval queue" },
        { name: "sending", description: "Send dispatcher status and manual trigger" },
        { name: "pipeline", description: "Kanban board data" },
        { name: "dashboard", description: "Funnel, send volume, runs and template performance" },
        { name: "settings", description: "Workspace settings, scoring, credentials and API key" },
        { name: "suppression", description: "Addresses and domains that are never emailed" },
        { name: "compliance", description: "Data deletion" },
        { name: "trigger", description: "Start a campaign run from automation (x-api-key)" },
        { name: "public", description: "Unsubscribe pages and provider webhooks (no session)" },
        { name: "ops", description: "Health checks" },
      ],
      components: {
        securitySchemes: {
          cookieAuth: { type: "apiKey", in: "cookie", name: COOKIE_NAME, description: "Session cookie set by POST /api/v1/auth/login" },
          apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key", description: "Workspace automation key (Settings > API keys)" },
        },
      },
      security: [{ cookieAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.decorate("authenticate", async (req) => {
    try {
      const payload = await req.jwtVerify<{ sub: string; ws: string }>();
      req.auth = { userId: payload.sub, workspaceId: payload.ws };
    } catch {
      throw new HttpError(401, "Not authenticated");
    }
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof ZodError || err.validation) {
      return reply.status(400).send({ error: "Validation failed", details: err.message });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: "Internal server error" });
  });

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  app.get("/health", { schema: { tags: ["ops"], security: [] } }, async () => ({ ok: true }));
  if (env.PLACES_PROVIDER === "mock") await app.register(mockSiteRoutes);
  app.get("/ready", { schema: { tags: ["ops"], security: [] } }, async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  await app.register(publicRoutes);

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(leadBulkRoutes);
      await api.register(leadRoutes);
      await api.register(campaignRoutes);
      await api.register(templateRoutes);
      await api.register(draftRoutes);
      await api.register(settingsRoutes);
      await api.register(sendingRoutes);
      await api.register(pipelineRoutes);
      await api.register(dashboardRoutes);
      await api.register(triggerRoutes);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
