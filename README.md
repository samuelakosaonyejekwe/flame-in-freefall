# Flame in Freefall

AI-powered fire safety insights from NASA microgravity combustion data. Built for the 2026 NASA Space Apps Challenge.

**Live dashboard:** https://samuelakosaonyejekwe.github.io/flame-in-freefall/

## What it does

- **Briefing**: mission-specific summary (ISS, Orion, lunar habitat, Mars transit, Mars surface), with top findings, a material screen, a readiness checklist and real incident lessons.
- **Insights**: transparent multi-criteria ranking of findings (safety impact, evidence, mission fit, actionability, novelty) with adjustable weights and CSV/JSON export.
- **Experiments**: 30+ investigations, from drop towers to Saffire on Cygnus, with a timeline, search and side-by-side comparison.
- **Fire envelope**: a screening flammability model across oxygen, pressure, gravity and ventilation. It flags the "hidden-risk zone", where a material passes the 1 g test but can burn in microgravity or partial gravity.
- **Ask FlameMind**: an AI analyst with cited answers. Instant mode runs entirely on-device. Deep mode uses a cloud LLM with the visitor's own API key, grounded in the same evidence.
- **Live NASA feed**: every visitor's browser pulls the newest NASA-affiliated research (OpenAlex) and imagery (NASA Image Library) directly. A scheduled GitHub Actions build refreshes the NASA Technical Reports Server snapshot every 6 hours.
- **Research gaps**: an evidence coverage matrix (hazard × conditions) with prioritized research questions.

## Architecture

Static site, no build step, no framework, no tracking. It runs on GitHub Pages, so it is independent of any personal machine.

```
index.html            app shell, strict Content Security Policy
assets/data.js        curated knowledge base (experiments, findings, incidents, glossary)
assets/engine.js      on-device AI: BM25 retrieval, ranking, flammability model, gaps, classifier
assets/live.js        live data from OpenAlex, NASA Images and the NTRS snapshot
assets/charts.js      dependency-free SVG charts
assets/app.js         views and interactions
sw.js                 offline support (installable PWA)
scripts/fetch-live.mjs  NTRS snapshot fetcher (run by GitHub Actions every 6 h)
```

## Run locally

```
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Data and limitations

Findings are distilled from public NASA summaries. Ratings are editorial, and the flammability model is an illustrative screening tool, not a certification method. Verify against primary sources in [NTRS](https://ntrs.nasa.gov) before making engineering decisions.
