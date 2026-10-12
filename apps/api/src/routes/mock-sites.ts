import type { FastifyPluginAsync } from "fastify";

const YEAR = new Date().getFullYear();

function good(slug: string) {
  return `<!doctype html><html><head><title>${slug} - Official Site</title><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Welcome to ${slug}">
</head><body><h1>${slug}</h1>${"<p>We offer great service and a warm welcome to every guest. Book your visit today.</p>".repeat(30)}
<form action="/contact"><input name="email"><button>Book now</button></form>
<a href="mailto:hello@${slug}.example.org">hello@${slug}.example.org</a><footer>&copy; ${YEAR} ${slug}</footer></body></html>`;
}

function poor(slug: string) {
  return `<html><head><title>${slug}</title></head><body><img src="https://static.wixstatic.com/media/logo.png"><h2>${slug}</h2>
<p>Welcome to our website. Call us.</p><footer>Copyright 2013 ${slug}</footer></body></html>`;
}

/** Offline stand-ins for business websites, used only by the mock places provider. */
export const mockSiteRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { kind: string; slug: string } }>("/mock-sites/:kind/:slug", async (req, reply) => {
    const { kind, slug } = req.params;
    reply.type("text/html");
    if (kind === "poor") {
      // simulate a slow, aging server
      await new Promise((r) => setTimeout(r, 400));
      return poor(slug);
    }
    return good(slug);
  });

  app.get<{ Params: { kind: string; slug: string } }>("/mock-sites/:kind/:slug/contact", async (req, reply) => {
    reply.type("text/html");
    // The poor site only reveals its email on the contact page, exercising enrichment.
    return req.params.kind === "poor"
      ? `<html><body>Contact us: <a href="mailto:owner@${req.params.slug}.example.org">email</a></body></html>`
      : good(req.params.slug);
  });
};
