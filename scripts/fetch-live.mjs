// Fetches the NASA Technical Reports Server, which does not allow direct
// browser requests, and writes live/ntrs.json. Runs every hour in GitHub
// Actions, so the deployed site refreshes without any personal machine.
// If NTRS is down, the snapshot currently deployed (PAGES_URL) is kept, so a
// bad run never rolls the site back to the older copy in the repository.
// Usage: [PAGES_URL=https://<user>.github.io/<repo>] node scripts/fetch-live.mjs
import { writeFile, readFile, mkdir } from "node:fs/promises";

const OUT = new URL("../live/", import.meta.url);
const UA = { "User-Agent": "flame-in-freefall-dashboard (NASA Space Apps 2026)", Accept: "application/json" };

const NTRS_QUERIES = [
  "microgravity combustion",
  "spacecraft fire safety",
  "flame spread microgravity",
  "fire suppression spacecraft",
  "material flammability oxygen",
  "partial gravity flame"
];

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

const clean = (s, n = 1200) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

async function ntrs() {
  const map = new Map();
  let ok = 0;
  for (const q of NTRS_QUERIES) {
    const url = `https://ntrs.nasa.gov/api/citations/search?q=${encodeURIComponent(q)}&page.size=25&sort.field=published&sort.order=desc`;
    let data;
    try { data = await getJSON(url); ok++; } catch (err) { console.warn(`query "${q}" failed: ${err.message}`); continue; }
    for (const r of data.results || []) {
      if (map.has(r.id)) continue;
      const pub = (r.publications || [])[0] || {};
      const date = (pub.publicationDate || r.distributionDate || r.submittedDate || r.created || "").slice(0, 10);
      map.set(r.id, {
        id: String(r.id),
        title: clean(r.title, 300),
        date,
        abstract: clean(r.abstract),
        type: r.stiType || "",
        center: (r.center && r.center.name) || "",
        venue: pub.publicationName || (r.meetings && r.meetings[0] && r.meetings[0].name) || "",
        doi: pub.doi || "",
        authors: (r.authorAffiliations || []).slice(0, 4).map((a) => a.meta && a.meta.author && a.meta.author.name).filter(Boolean),
        url: `https://ntrs.nasa.gov/citations/${r.id}`
      });
    }
  }
  if (!ok) throw new Error("all NTRS queries failed");
  return [...map.values()].filter((x) => x.title && x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
}

async function deployedSnapshot(name) {
  const base = process.env.PAGES_URL;
  if (!base) return null;
  try {
    const d = await getJSON(`${base.replace(/\/$/, "")}/live/${name}`, 2);
    return Array.isArray(d.items) && d.items.length ? d : null;
  } catch { return null; }
}

async function save(name, fn) {
  const file = new URL(name, OUT);
  try {
    const items = await fn();
    if (!items.length) throw new Error("no items");
    await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, items }));
    console.log(`${name}: ${items.length} items`);
  } catch (err) {
    const live = await deployedSnapshot(name);
    if (live) { await writeFile(file, JSON.stringify(live)); console.warn(`${name}: kept deployed snapshot from ${live.generatedAt} (${err.message})`); return; }
    try { await readFile(file); console.warn(`${name}: kept repository snapshot (${err.message})`); }
    catch { await writeFile(file, JSON.stringify({ generatedAt: null, count: 0, items: [] })); console.warn(`${name}: empty (${err.message})`); }
  }
}

await mkdir(OUT, { recursive: true });
await save("ntrs.json", ntrs);
