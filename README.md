# Flame in Freefall

Fire safety insights from NASA microgravity combustion data. Built for the 2026 NASA Space Apps Challenge.

**Live dashboard:** https://samuelakosaonyejekwe.github.io/flame-in-freefall/

## What it does

- **Briefing**: a mission view for ISS, Orion, a lunar habitat, Mars transit or a Mars habitat. It shows the top findings, a material screen, a readiness checklist and lessons from real incidents.
- **Insights**: a transparent ranking of findings by safety impact, evidence, mission fit, actionability and novelty. You can adjust the weights and export the ranking as CSV or JSON.
- **Experiments**: NASA and partner investigations, from drop towers to Saffire fires on Cygnus, with a timeline, search and side-by-side comparison.
- **Fire envelope**: a screening flammability model across oxygen, pressure, gravity and ventilation. It flags the "hidden-risk zone", where a material passes the 1 g upward test but can burn in microgravity or partial gravity.
- **Ask FlameMind**: questions answered with citations, worked out on the device. Nothing you type leaves it, and it works offline.
- **Live NASA feed**: the newest research on fire in space, from NASA and the wider community, plus NASA imagery, tagged by hazard and mission.
- **Research gaps**: an evidence coverage matrix (hazard × conditions) with prioritized research questions.

## Always current, independent of any scheduler or personal machine

Each visitor's browser fetches NASA data on every visit, and again while the page is open:

| Source | What | Route |
|---|---|---|
| NASA Technical Reports Server | newest NASA reports | project relay (NTRS blocks browsers) |
| OpenAlex | NASA-affiliated papers | relay, else direct |
| Crossref | NASA-funded journal and conference papers | relay, else direct |
| NASA Image and Video Library | experiment imagery | direct |

- **The project relay** (`relay/`) is a Cloudflare Worker with fixed endpoints (`/v1/ntrs`, `/v1/openalex`, `/v1/crossref`). It is not an open proxy. Cloudflare's own hourly trigger refreshes each source, and every visitor is served that stored copy, so freshness depends on neither GitHub's scheduler nor any computer. Shared caching also keeps visitors far inside the free API limits (OpenAlex budgets requests per network address; Crossref allows 1 request per second). If a source is down, the relay keeps serving its last good copy, marked as stale.
- **Fallbacks:** if the relay is unreachable, OpenAlex and Crossref are read directly from the browser, and every source falls back to a starter copy published with the site (`live/*.json`). Each device also keeps its last good copy, so the feed never empties.
- **Publishing:** the GitHub Actions build refreshes the starter copies on every push, and hourly when GitHub's scheduler fires. It is no longer what keeps the feed fresh.
- **One definition of every source:** `relay/sources.mjs` is used by both the relay and the build. `scripts/check-queries.mjs` fails the build if the browser's direct fallbacks drift from it.

### Deploying the relay

The relay stores its copies in Workers KV, because Cloudflare's cache has no effect on `*.workers.dev` addresses. A Cloudflare cron trigger refreshes them hourly.

```
cd relay
npx -p node@24 -p wrangler@4.147.0 -c "wrangler login"
npx -p node@24 -p wrangler@4.147.0 -c "wrangler kv namespace create DATA"   # put the printed id in wrangler.toml
npx -p node@24 -p wrangler@4.147.0 -c "wrangler deploy"
gh variable set RELAY_URL --body "https://flame-in-freefall-relay.<your-subdomain>.workers.dev"
```

Optional: a free OpenAlex API key gives the relay its own OpenAlex budget. Set it with `wrangler secret put OPENALEX_API_KEY` (it is never stored in the repository).

## Install and offline use

Use the **Install app** button in the top bar (on phones: **More**, then **Install & offline**).

- **Installed app** (Android, iPhone and iPad, Windows, macOS, ChromeOS, Linux): open the site once while online, then install it. A service worker saves every app file, the NASA report snapshot and viewed images. After that the app opens and works in airplane mode, and updates itself when you are back online.
- **Offline edition**: `flame-in-freefall-offline.html`, generated on every publish. It is one file with all scripts, styles, fonts and the latest report snapshot inside. Open it in any browser with no network and no installation, for example on desktop Firefox, which cannot install web apps.

Only the live refresh needs a connection. Everything else, including Ask FlameMind, works offline.

## Architecture

There is no framework, no build step for development, no backend, no third-party scripts and no tracking.

```
index.html               app shell with a strict Content Security Policy and link-preview tags
404.html                 sends mistyped addresses back to the dashboard
manifest.webmanifest     install metadata (icons, shortcuts)
sw.js                    offline engine (precache, saved data, image cache, updates)
assets/data.js           curated knowledge base: experiments, findings, incidents, glossary
assets/engine.js         analysis engine: BM25 retrieval, ranking, flammability model, gaps, classifier
assets/live.js           live data, with relay → direct → published-copy fallbacks
relay/                   Cloudflare Worker relay and the shared source definitions
assets/charts.js         dependency-free SVG charts
assets/app.js            views, interactions, install and offline features
assets/fonts/            self-hosted fonts and their SIL Open Font License texts
live/*.json              starter copies of each source, refreshed on every publish
scripts/fetch-live.mjs   refreshes the starter copies (live/*.json)
scripts/check-queries.mjs  build guard: browser fallbacks match relay/sources.mjs
scripts/build-offline.mjs  builds the single-file offline edition
scripts/stamp-sw.mjs     stamps the service worker with the release version and file list
.github/workflows/pages.yml  publish on push and every hour
```

## Run locally

```
python3 -m http.server 8080
```

Then open http://localhost:8080. Offline mode works on `localhost` too.

To reproduce a published build:

```
mkdir -p _site && cp -r index.html 404.html sw.js manifest.webmanifest assets live _site/
sed -i -e "s#__SITE_URL__#http://localhost:8080/#g" -e "s#__RELAY_URL__##g" -e "s#__RELAY_ORIGIN__##g" _site/index.html _site/404.html
node scripts/build-offline.mjs _site && node scripts/stamp-sw.mjs _site local
```

## Data, ratings and model

- Findings are distilled from public NASA summaries.
- **Evidence strength is computed**, not hand-rated. It starts from the best supporting test platform: 4 for spacecraft-scale fires or standardized ground testing, 3 for long-duration orbital tests, 2 for short-duration microgravity. Add 1 when two or more investigations agree, and subtract 1 when all are still preliminary. Documented incidents score 5.
- **Safety impact, novelty, actionability and mission fit** are rated against a published rubric (shown in Data & method). You can reweight every criterion.
- **The flammability model** reproduces the trends NASA measured: a U-shaped boundary with flow, a lower limit at low flow and partial gravity, and more risk in enriched atmospheres.
  - On every load it runs nine checks, five of them against NASA observations it was not fitted to (SSCE, Saffire, partial-gravity and exploration-atmosphere results).
  - Every result is shown with its range across the model's coefficient uncertainty.
  - It is a screening and teaching tool, not a certification method.
- Live items are tagged with a keyword classifier, so expect occasional mis-tags.
- Verify against primary sources in [NTRS](https://ntrs.nasa.gov) before making engineering decisions.
