# El Paso Historical Temperature Visualizer — Design

**Repo:** https://github.com/dristanta-silwal/all-weather
**Date:** 2026-08-11
**Status:** Approved

## Goal

A static web app, hosted on GitHub Pages, that tracks and visualizes 5 years of daily
high/low temperatures for El Paso, TX, with an interactive zoomable chart, a °C/°F
toggle, a light/dark theme toggle, and daily automated data updates via GitHub Actions.

## Architecture

Pure static site: HTML/CSS/JS, no build step, no backend. GitHub Pages is configured
to "deploy from branch" (`main`, root), so every commit to `main` — including the
daily automated data-update commit — triggers a redeploy with no separate deploy
workflow needed.

```
/
├── index.html
├── style.css                    (light/dark theme via CSS variables + toggle)
├── app.js                       (ECharts setup, filters, unit/theme toggle logic)
├── data/
│   └── cities/
│       └── el-paso.json         (rolling 5-year daily high/low, stored in °C)
├── scripts/
│   ├── cities.config.js         (per-city metadata: id, name, lat, lon, timezone)
│   ├── backfill.js              (one-time: fetch full 5-yr history for a city)
│   └── update.js                (daily: fetch yesterday for all configured cities)
└── .github/workflows/
    └── update-data.yml          (cron-scheduled, runs update.js, commits+pushes)
```

## Data Pipeline

- **Backfill** (`scripts/backfill.js <city-id>`, run once per city, manually):
  calls Open-Meteo's historical archive API for the city's coordinates, covering
  the last 5 years, and writes `data/cities/<city-id>.json` as
  `[{date, high_c, low_c}, ...]`. Run once now for `el-paso`.
- **Daily update** (GitHub Action, cron): runs `scripts/update.js`, which loops
  over every city in `cities.config.js`, fetches yesterday's high/low for each
  (using Open-Meteo's `timezone` param so "yesterday" is the city's local
  calendar day, regardless of the cron's UTC run time), appends the new record,
  and drops any record older than 5 years so each city's file stays a rolling
  window. Commits changed files back to `main` with a bot commit.
- Data is stored in **Celsius only** — each city's JSON is the single source of
  truth; the °C/°F toggle converts client-side, so there's no derived data to
  keep in sync.
- No API keys or secrets are required — Open-Meteo's endpoints are free and
  unauthenticated.

## Multi-City Extensibility

Only El Paso is wired up today, but the data/script layer is shaped so adding a
new city later doesn't require restructuring:

- Add one entry to `scripts/cities.config.js` (id, display name, lat/lon, timezone).
- Run `scripts/backfill.js <new-city-id>` once to seed its history.
- The daily cron automatically picks up the new city on its next run — no script
  changes needed.

The frontend intentionally does **not** get a city-switcher UI in this pass — it
loads `data/cities/el-paso.json` directly. Adding a selector is deferred until a
second city actually exists, to avoid building UI for data that doesn't exist yet.

## Frontend

- **Chart**: ECharts line chart (two series: high, low) using its built-in
  `dataZoom` for brush/zoom. Preset buttons ("Last 30 Days", "This Year",
  "5-Year Overview") call ECharts' zoom API with computed date ranges.
- **Unit toggle**: header button, flips °C/°F across chart axes/tooltips/summary
  stats instantly (re-renders from the same underlying Celsius data), persisted
  to `localStorage`.
- **Theme toggle**: light/dark, same persistence pattern as the unit toggle,
  stored under a separate `localStorage` key.
- **Summary row**: highest temp, lowest temp, and days ≥ 100°F/38°C — computed
  from whichever date range is currently active in the chart (zoomed/filtered),
  not a static full-history figure. Updates live as the user zooms or pans.

## Deployment & CI

- GitHub Pages: *Settings → Pages* → Source "Deploy from a branch", branch
  `main`, folder `/ (root)` — one-time manual setup, no workflow required.
- `.github/workflows/update-data.yml`: cron-scheduled (daily, ~12:00 UTC — safely
  after El Paso's local midnight), runs Node, executes `scripts/update.js`,
  commits `data/cities/*.json` if changed, pushes to `main`.
- Requires *Settings → Actions → General → Workflow permissions* set to
  "Read and write permissions" so the bot commit can be pushed.

## Manual Setup Steps (user-performed)

1. ~~Create the GitHub repo~~ — done: https://github.com/dristanta-silwal/all-weather
2. Set *Settings → Actions → General → Workflow permissions* to "Read and write
   permissions" on the repo, so the daily job can push its commit.
3. Set *Settings → Pages* → Source: "Deploy from a branch", Branch: `main`,
   folder `/ (root)`.
4. Optional: after the first push, manually trigger "Update Data" from the
   *Actions* tab once to confirm the pipeline works end-to-end, instead of
   waiting for the next scheduled run.

## Out of Scope (this pass)

- City-switcher UI / multi-city frontend (structural hooks only, see above).
- Any backend/server component — the app is fully static.
- Historical data sources other than Open-Meteo.
