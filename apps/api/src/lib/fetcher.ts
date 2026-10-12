import { isIP } from "node:net";
import { robotsAllows } from "@leadforge/shared";
import { env } from "../env.js";

export const USER_AGENT = "LeadForgeBot/1.0 (+website audit; contact via workspace owner)";
const MIN_HOST_INTERVAL_MS = env.NODE_ENV === "test" ? 0 : 1000;
const MAX_BYTES = 1_500_000;

const lastHit = new Map<string, number>();
const robotsCache = new Map<string, { txt: string | null; at: number }>();

/** Per-host politeness: serialise requests to a host with a minimum interval. */
const hostChains = new Map<string, Promise<void>>();
async function throttle(host: string) {
  const prev = hostChains.get(host) ?? Promise.resolve();
  const next = prev.then(async () => {
    const wait = (lastHit.get(host) ?? 0) + MIN_HOST_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastHit.set(host, Date.now());
  });
  hostChains.set(host, next.catch(() => {}));
  await next;
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(host) === 6) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  return false;
}

export type FetchOutcome =
  | { ok: true; status: number; finalUrl: string; html: string; ms: number; lastModified: string | null }
  | { ok: false; reason: "BLOCKED_ROBOTS" | "BLOCKED_PRIVATE" | "INVALID_URL" | "TIMEOUT" | "SSL" | "NETWORK" | "HTTP_ERROR"; detail: string };

async function robotsFor(origin: string): Promise<string | null> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 3600_000) return cached.txt;
  let txt: string | null = null;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) txt = (await res.text()).slice(0, 100_000);
  } catch {
    txt = null;
  }
  robotsCache.set(origin, { txt, at: Date.now() });
  return txt;
}

/**
 * Polite page fetch for website audits: respects robots.txt, throttles per host, has a
 * timeout and body cap, and refuses private/loopback hosts (SSRF guard) outside mock mode.
 */
export async function politeFetch(rawUrl: string, timeoutMs = 10_000): Promise<FetchOutcome> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { ok: false, reason: "INVALID_URL", detail: rawUrl };
  }
  if (!["http:", "https:"].includes(url.protocol)) return { ok: false, reason: "INVALID_URL", detail: rawUrl };
  const allowPrivate = env.PLACES_PROVIDER === "mock" || env.NODE_ENV === "test";
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    return { ok: false, reason: "BLOCKED_PRIVATE", detail: url.hostname };
  }

  const robots = await robotsFor(url.origin);
  if (robots && !robotsAllows(robots, USER_AGENT, url.pathname || "/")) {
    return { ok: false, reason: "BLOCKED_ROBOTS", detail: `${url.origin} disallows ${url.pathname}` };
  }

  await throttle(url.host);
  const started = performance.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = performance.now() - started;
    if (res.status >= 400) return { ok: false, reason: "HTTP_ERROR", detail: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    const html = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
    return { ok: true, status: res.status, finalUrl: res.url || url.toString(), html, ms, lastModified: res.headers.get("last-modified") };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const code = e.cause?.code ?? "";
    if (e.name === "TimeoutError" || e.name === "AbortError") return { ok: false, reason: "TIMEOUT", detail: `No response in ${timeoutMs} ms` };
    if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return { ok: false, reason: "SSL", detail: code };
    return { ok: false, reason: "NETWORK", detail: code || e.message };
  }
}
