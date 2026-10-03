// Flame in Freefall data relay (Cloudflare Worker).
//
// Lets every visitor's browser read the NASA Technical Reports Server, which
// blocks browser requests, and shares one stored copy of each source between
// all visitors, so nobody depends on GitHub's scheduler or uses up a free API
// budget.
//
//   GET /v1/ntrs      newest NASA technical reports (shaped)
//   GET /v1/openalex  NASA-affiliated papers (OpenAlex format)
//   GET /v1/crossref  NASA-funded papers (Crossref format)
//   GET /v1/health    liveness and the age of each stored copy
//
// Fixed endpoints only: it is not an open proxy.
//
// Storage is Workers KV (binding DATA). Cloudflare's Cache API does nothing on
// *.workers.dev, so it is not used. A Cloudflare cron trigger refreshes every
// source hourly; a request that finds a copy older than that refreshes it in
// the background (stale-while-revalidate). A failed refresh keeps the last
// good copy, which is served with X-Relay-Stale: 1.
import { FETCHERS } from "./sources.mjs";

const FRESH_MS = 60 * 60 * 1000;          // refresh after an hour
const RETRY_MS = 75 * 60 * 1000;          // requests trigger a refresh only if the cron is late
const SOURCES = ["ntrs", "openalex", "crossref"];
const CORS = {
  "Access-Control-Allow-Origin": "*",               // public data, no credentials
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "X-Relay-Age, X-Relay-Stale"
};

function respond(body, status, extra = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...CORS, ...extra }
  });
}

async function fetchSource(source, env) {
  const ua = { "User-Agent": "flame-in-freefall-relay (NASA Space Apps 2026)", Accept: "application/json" };
  const withUA = (u, i = {}) => fetch(u, { ...i, headers: { ...ua, ...(i.headers || {}) } });
  if (source === "ntrs") return FETCHERS.ntrs(fetch, ua);
  if (source === "openalex") return FETCHERS.openalex(withUA, env.OPENALEX_API_KEY || "");
  return FETCHERS.crossref(withUA);
}

// Fetch a source and store it. On failure the previous copy stays.
async function refresh(source, env) {
  const data = await fetchSource(source, env);
  await env.DATA.put(`src:${source}`, JSON.stringify(data), { metadata: { at: Date.now() } });
  return data;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return respond(JSON.stringify({ error: "method not allowed" }), 405);

    if (url.pathname === "/v1/health") {
      const ages = {};
      for (const s of SOURCES) {
        const { metadata } = await env.DATA.getWithMetadata(`src:${s}`);
        ages[s] = metadata && metadata.at ? Math.round((Date.now() - metadata.at) / 60000) + " min" : "none";
      }
      return respond(JSON.stringify({ ok: true, age: ages }), 200, { "Cache-Control": "no-store" });
    }

    const m = url.pathname.match(/^\/v1\/(ntrs|openalex|crossref)$/);
    if (!m) return respond(JSON.stringify({ error: "not found" }), 404);
    const source = m[1];

    const { value, metadata } = await env.DATA.getWithMetadata(`src:${source}`);
    if (value) {
      const age = Date.now() - ((metadata && metadata.at) || 0);
      if (age > RETRY_MS) ctx.waitUntil(refresh(source, env).catch(() => {}));   // serve now, refresh behind
      return respond(value, 200, { "X-Relay-Age": String(Math.round(age / 1000)), "X-Relay-Stale": age > FRESH_MS ? "1" : "0", "Cache-Control": "public, max-age=300" });
    }
    try {
      const data = await refresh(source, env);
      return respond(JSON.stringify(data), 200, { "X-Relay-Age": "0", "X-Relay-Stale": "0", "Cache-Control": "public, max-age=300" });
    } catch (err) {
      return respond(JSON.stringify({ error: "source unavailable", detail: String((err && err.message) || err).slice(0, 200) }), 502, { "Cache-Control": "no-store" });
    }
  },

  // Cloudflare cron trigger (see wrangler.toml): refresh every source hourly.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all(SOURCES.map((s) => refresh(s, env).catch((e) => console.warn(`${s}: ${e.message}`)))));
  }
};
