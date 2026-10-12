import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import argon2 from "argon2";
import { loginSchema, registerSchema } from "@leadforge/shared";
import { COOKIE_NAME } from "../constants.js";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { HttpError } from "../services/leads.js";
import { ensureDefaultTemplates } from "../services/drafts.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  function setSession(
    reply: import("fastify").FastifyReply,
    user: { id: string; workspaceId: string },
  ) {
    const token = app.jwt.sign({ sub: user.id, ws: user.workspaceId }, { expiresIn: "7d" });
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
  }

  r.post("/auth/register", { schema: { body: registerSchema, tags: ["auth"], security: [], description: "Creates the first user and workspace. Closed once a user exists." } }, async (req, reply) => {
    const { email, password, name, workspaceName } = req.body;
    // Single workspace to start: only the first user may self-register.
    if ((await prisma.user.count()) > 0) throw new HttpError(403, "Registration is closed");
    const passwordHash = await argon2.hash(password);
    const user = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({ data: { name: workspaceName ?? `${name}'s workspace` } });
      return tx.user.create({
        data: { workspaceId: ws.id, email: email.toLowerCase(), passwordHash, name, role: "OWNER" },
      });
    });
    await ensureDefaultTemplates(user.workspaceId);
    setSession(reply, user);
    return { id: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId };
  });

  r.post("/auth/login", { schema: { body: loginSchema, tags: ["auth"], security: [] } }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, req.body.password))) {
      throw new HttpError(401, "Invalid email or password");
    }
    setSession(reply, user);
    return { id: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId };
  });

  r.post("/auth/logout", { schema: { tags: ["auth"] } }, async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  r.get("/auth/me", { preHandler: app.authenticate, schema: { tags: ["auth"] } }, async (req) => {
    const user = await prisma.user.findFirst({
      where: { id: req.auth.userId, workspaceId: req.auth.workspaceId },
      select: { id: true, email: true, name: true, role: true, workspaceId: true },
    });
    if (!user) throw new HttpError(401, "Not authenticated");
    return user;
  });
};
