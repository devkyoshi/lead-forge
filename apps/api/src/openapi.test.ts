import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";

type Operation = { tags?: string[]; security?: unknown[]; summary?: string };
type Doc = {
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown> };
  security: unknown[];
};

let app: FastifyInstance;
let doc: Doc;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  doc = app.swagger() as unknown as Doc;
});
afterAll(() => app.close());

describe("OpenAPI document", () => {
  it("documents the main resources", () => {
    const paths = Object.keys(doc.paths);
    for (const p of [
      "/api/v1/auth/login",
      "/api/v1/leads",
      "/api/v1/leads/bulk",
      "/api/v1/leads/export.csv",
      "/api/v1/campaigns",
      "/api/v1/campaigns/{id}/run",
      "/api/v1/runs/{id}",
      "/api/v1/templates/preview",
      "/api/v1/drafts/bulk",
      "/api/v1/pipeline",
      "/api/v1/dashboard/summary",
      "/api/v1/trigger/campaigns/{id}/run",
      "/u/{token}",
      "/webhooks/sendgrid/events",
    ]) {
      expect(paths, p).toContain(p);
    }
  });

  it("declares both auth schemes and marks public endpoints as unauthenticated", () => {
    expect(Object.keys(doc.components.securitySchemes)).toEqual(expect.arrayContaining(["cookieAuth", "apiKeyAuth"]));
    expect(doc.security).toEqual([{ cookieAuth: [] }]);
    expect(doc.paths["/u/{token}"]!.get!.security).toEqual([]);
    expect(doc.paths["/webhooks/sendgrid/events"]!.post!.security).toEqual([]);
    expect(doc.paths["/api/v1/auth/login"]!.post!.security).toEqual([]);
    expect(doc.paths["/api/v1/trigger/campaigns/{id}/run"]!.post!.security).toEqual([{ apiKeyAuth: [] }]);
  });

  it("tags every operation so the docs are grouped", () => {
    const untagged: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) if (!op.tags?.length) untagged.push(`${method.toUpperCase()} ${path}`);
    }
    expect(untagged).toEqual([]);
  });

  it("serves the document and the UI", async () => {
    const json = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(json.statusCode).toBe(200);
    expect(JSON.parse(json.body).info.title).toBe("LeadForge API");
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBeLessThan(400);
  });
});
