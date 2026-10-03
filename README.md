# Flame in Freefall

Fire safety insights from NASA microgravity combustion data. Built for the 2026 NASA Space Apps Challenge.

**Live dashboard:** https://samuelakosaonyejekwe.github.io/flame-in-freefall/

## What it does

- **Briefing**: a mission view for ISS, Orion, a lunar habitat, Mars transit or a Mars habitat. It shows the top findings, a material screen, a readiness checklist and lessons from real incidents.
- **Insights**: a transparent ranking of findings by safety impact, evidence, mission fit, actionability and novelty. You can adjust the weights and export the ranking as CSV or JSON.
- **Experiments**: NASA and partner investigations, from drop towers to Saffire fires on Cygnus, with a timeline, search and side-by-side comparison.
- **Fire envelope**: a screening flammability model across oxygen, pressure, gravity and ventilation. It flags the "hidden-risk zone", where a material passes the 1 g upward test but can burn in microgravity or partial gravity.
- **Ask FlameMind**: questions answered with citations. Instant mode runs on the device. Deep mode (optional) sends the same evidence to the Anthropic API with the visitor's own key.
- **Live NASA feed**: the newest NASA-affiliated research and imagery, tagged by hazard and mission.
- **Research gaps**: an evidence coverage matrix (hazard × conditions) with prioritized research questions.

## Always current, independent of any personal machine

The site is static and hosted on GitHub Pages.

- Every visitor's browser fetches **OpenAlex** (NASA-affiliated papers) and the **NASA Image and Video Library** directly on each visit, and again every 15 minutes while the page is open.
- The **NASA Technical Reports Server** does not accept browser requests. A scheduled GitHub Actions run fetches it every 6 hours and republishes the site. If NTRS is down, the snapshot already published is kept.
- GitHub pauses scheduled workflows after 60 days without repository activity. Each scheduled run re-enables its own schedule through the GitHub API, without creating commits, to keep the refresh going.

## Install and offline use

Use the **Install app** button in the top bar (on phones: **More**, then **Install & offline**).

- **Installed app** (Android, iPhone and iPad, Windows, macOS, ChromeOS, Linux): open the site once while online, then install it. A service worker saves every app file, the NASA report snapshot and viewed images. After that the app opens and works in airplane mode, and updates itself when you are back online.
- **Offline edition**: `flame-in-freefall-offline.html`, generated on every publish. It is one file with all scripts, styles, fonts and the latest report snapshot inside. Open it in any browser with no network and no installation, for example on desktop Firefox, which cannot install web apps.

Deep mode and the live refresh need a connection. Everything else works offline.

## Architecture

There is no framework, no build step for development, no backend and no tracking.

```
index.html               app shell with a strict Content Security Policy
manifest.webmanifest     install metadata (icons, shortcuts)
sw.js                    offline engine (precache, saved data, image cache, updates)
assets/data.js           curated knowledge base: experiments, findings, incidents, glossary
assets/engine.js         analysis engine: BM25 retrieval, ranking, flammability model, gaps, classifier
assets/live.js           live data: OpenAlex, NASA Images, NTRS snapshot
assets/charts.js         dependency-free SVG charts
assets/app.js            views, interactions, install and offline features
assets/fonts/            self-hosted fonts (SIL Open Font License)
live/ntrs.json           NTRS snapshot; the copy in the repository is a seed, refreshed on every publish
scripts/fetch-live.mjs   NTRS snapshot fetcher
scripts/build-offline.mjs  builds the single-file offline edition
scripts/stamp-sw.mjs     stamps the service worker with the release version and file list
.github/workflows/pages.yml  publish on push and every 6 hours
```

## Run locally

```
python3 -m http.server 8080
```

Then open http://localhost:8080. Offline mode works on `localhost` too.

To reproduce a published build:

```
mkdir -p _site && cp -r index.html sw.js manifest.webmanifest assets live _site/
node scripts/build-offline.mjs _site && node scripts/stamp-sw.mjs _site local
```

## Data and limitations

- Findings are distilled from public NASA summaries. The ratings are editorial judgements, and the dashboard lets you reweight them.
- The flammability model reproduces the trends NASA measured: a U-shaped boundary with flow, a lower limit at low flow and partial gravity, and more risk in enriched atmospheres. Its coefficients are illustrative, so it is a screening and teaching tool, not a certification method.
- Live items are tagged with a keyword classifier, so expect occasional mis-tags.
- Verify against primary sources in [NTRS](https://ntrs.nasa.gov) before making engineering decisions.
