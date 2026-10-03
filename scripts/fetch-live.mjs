// Writes starter copies of every live source to live/*.json for the published
// site, so even a first visit with every service down shows recent data.
// The browser refreshes from the relay or the sources themselves; these files
// are only the starting point and offline copy.
//
// For each source, in order: the relay (shared cache), the source itself,
// the copy already published (PAGES_URL), then the copy in the repository.
// A bad run therefore never replaces good data with an empty or older file.
//
// Usage: [RELAY_URL=https://...] [PAGES_URL=https://<user>.github.io/<repo>] node scripts/fetch-live.mjs
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { FETCHERS } from "../relay/sources.mjs";

const OUT = new URL("../live/", import.meta.url);
const UA = { "User-Agent": "flame-in-freefall-build (NASA Space Apps 2026)", Accept: "application/json" };
const withUA = (u, i = {}) => fetch(u, { ...i, headers: { ...UA, ...(i.headers || {}) } });

function usable(source, d) {
  if (!d || typeof d !== "object") return false;
  if (source === "ntrs") return Array.isArray(d.items) && d.items.length > 0;
  if (source === "openalex") return Array.isArray(d.results) && d.results.length > 0;
  return Array.isArray(d.message && d.message.items) && d.message.items.length > 0;
}

async function fromUrl(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function refresh(source) {
  const file = new URL(`${source}.json`, OUT);
  const attempts = [];
  if (process.env.RELAY_URL) attempts.push(["relay", () => fromUrl(`${process.env.RELAY_URL.replace(/\/$/, "")}/v1/${source}`)]);
  attempts.push(["source", () => FETCHERS[source](withUA, source === "ntrs" ? UA : process.env.OPENALEX_API_KEY || "")]);
  if (process.env.PAGES_URL) attempts.push(["published copy", () => fromUrl(`${process.env.PAGES_URL.replace(/\/$/, "")}/live/${source}.json`)]);
  for (const [name, run] of attempts) {
    try {
      const d = await run();
      if (!usable(source, d)) throw new Error("empty");
      await writeFile(file, JSON.stringify(d));
      console.log(`${source}: from ${name}, generated ${d.generatedAt || "unknown"}`);
      return;
    } catch (err) { console.warn(`${source}: ${name} failed (${err.message})`); }
  }
  try { await readFile(file); console.warn(`${source}: kept repository copy`); }
  catch { await writeFile(file, JSON.stringify({ generatedAt: null })); console.warn(`${source}: no data`); }
}

await mkdir(OUT, { recursive: true });
for (const s of ["ntrs", "openalex", "crossref"]) await refresh(s);
