// One definition of every live source: what to ask, and how to shape the
// answer. Used by the relay (relay/worker.mjs) and by the publish build
// (scripts/fetch-live.mjs), so the two can never disagree. The browser's
// direct-fallback queries in assets/live.js are checked against these by
// scripts/check-queries.mjs during the build.

export const NASA_OPENALEX = "I4210124779";          // National Aeronautics and Space Administration
export const NASA_FUNDER = "10.13039/100000104";      // NASA in the Crossref funder registry

export const QUERIES = {
  ntrs: [
    "microgravity combustion",
    "spacecraft fire safety",
    "flame spread microgravity",
    "fire suppression spacecraft",
    "material flammability oxygen",
    "partial gravity flame"
  ],
  openalex: [
    "microgravity AND (flame OR combustion OR fire OR smoke)",
    "(flammability OR \"fire safety\" OR \"flame spread\") AND (spacecraft OR lunar OR \"reduced gravity\" OR \"partial gravity\" OR microgravity)"
  ],
  crossref: [
    "microgravity flame spread",
    "spacecraft fire safety",
    "partial gravity flammability",
    "microgravity combustion smoke suppression"
  ]
};

const clean = (s, n = 1200) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(fetchFn, url, init = {}, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) { last = err; if (i < tries - 1) await pause(1500); }
  }
  throw last;
}

// NASA Technical Reports Server: newest reports, shaped and de-duplicated.
export async function fetchNTRS(fetchFn, headers = {}) {
  const map = new Map();
  let ok = 0;
  for (const q of QUERIES.ntrs) {
    const url = `https://ntrs.nasa.gov/api/citations/search?q=${encodeURIComponent(q)}&page.size=25&sort.field=published&sort.order=desc`;
    let data;
    try { data = await getJSON(fetchFn, url, { headers }); ok++; } catch { continue; }
    for (const r of data.results || []) {
      if (map.has(r.id) || !/^\d+$/.test(String(r.id))) continue;
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
  const items = [...map.values()].filter((x) => x.title && x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
  return { generatedAt: new Date().toISOString(), count: items.length, items };
}

// OpenAlex: NASA-affiliated works, returned in OpenAlex's own shape.
export async function fetchOpenAlex(fetchFn, apiKey = "") {
  const base = "https://api.openalex.org/works?select=id,doi,title,publication_date,primary_location,authorships,abstract_inverted_index,cited_by_count&sort=publication_date:desc&per-page=40" +
    (apiKey ? "&api_key=" + encodeURIComponent(apiKey) : "") + "&filter=authorships.institutions.lineage:" + NASA_OPENALEX + ",title_and_abstract.search:";
  const pages = await Promise.all(QUERIES.openalex.map((q) => getJSON(fetchFn, base + encodeURIComponent(q))));
  return { generatedAt: new Date().toISOString(), results: pages.flatMap((p) => p.results || []) };
}

// Crossref: NASA-funded journal and conference papers from the last three
// years, relevance-ranked. Keyless use allows 1 request per second, so
// queries run one at a time, 1.1 s apart.
export async function fetchCrossref(fetchFn) {
  const since = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
  const items = [];
  let ok = 0;
  for (const [i, q] of QUERIES.crossref.entries()) {
    if (i) await pause(1100);
    const url = "https://api.crossref.org/works?select=DOI,title,published,published-online,container-title,author,abstract,is-referenced-by-count&rows=25" +
      "&filter=funder:" + NASA_FUNDER + ",from-pub-date:" + since + "&query.bibliographic=" + encodeURIComponent(q);
    try { const d = await getJSON(fetchFn, url); items.push(...((d.message || {}).items || [])); ok++; } catch { /* keep the others */ }
  }
  if (!ok) throw new Error("all Crossref queries failed");
  return { generatedAt: new Date().toISOString(), message: { items } };
}

export const FETCHERS = { ntrs: fetchNTRS, openalex: fetchOpenAlex, crossref: fetchCrossref };
