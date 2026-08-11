# El Paso Historical Climate Visualizer — Design

**Repo:** https://github.com/dristanta-silwal/all-weather
**Date:** 2026-08-11 (updated post-implementation)
**Status:** Implemented

## Goal

A static web app, hosted on GitHub Pages, that tracks and visualizes 5 years of
daily desert climate data for El Paso, TX — temperature, UV index, wind,
precipitation, humidity, and dust (PM10) — with interactive zoomable charts,
a full °C/°F+mph+in ↔ °C+km/h+mm unit toggle, a light/dark theme, and daily
automated data updates via GitHub Actions.

This supersedes the original single-metric temperature-only spec; the
architectural core (static site, no backend, GitHub Pages deploy-from-branch,
metric-canonical storage) is unchanged from that original design.

## Architecture

Pure static site: HTML/CSS/JS, no build step, no backend, no bundler. GitHub
Pages is configured to "deploy from branch" (`main`, root), so every commit to
`main` — including the daily automated data-update commit — triggers a
redeploy with no separate deploy workflow needed.

```
/
├── index.html                   # semantic HTML, full SEO meta block
├── style.css                    # "Desert Calm" design tokens, light/dark
├── app.js                       # chart rendering, filters, toggles, reorder
├── robots.txt, sitemap.xml, site.webmanifest
├── favicon.ico, icon.svg, apple-touch-icon.png
├── assets/
│   ├── fonts/                   # self-hosted woff2 (Bricolage Grotesque,
│   │                            #   Public Sans, JetBrains Mono)
│   ├── og-image.svg/.png        # 1200x630 social preview
├── lib/
│   └── echarts.min.js           # vendored, no CDN dependency
├── data/
│   └── cities/
│       ├── el-paso.json         # rolling 5yr {date, high_c, low_c,
│       │                        #   uv_index_max, wind_speed_max_kmh,
│       │                        #   wind_gusts_max_kmh, precipitation_mm,
│       │                        #   humidity_mean_pct}
│       └── el-paso-aqi.json     # {date, pm10} — shorter range, own archive
├── scripts/
│   ├── cities.config.js         # [{id, name, lat, lon, timezone}]
│   ├── openmeteo.js             # shared fetch-with-retry, validation,
│   │                            #   hourly-to-daily aggregation helpers
│   ├── backfill.js              # one-time: 5yr weather history (archive API)
│   │                            #   + recent UV (forecast API) + AQI history
│   └── update.js                # daily: forecast API + AQI API, validate,
│                                 #   retry, trim to 5yr rolling window
└── .github/workflows/
    └── update-data.yml          # cron, runs update.js, opens issue on failure
```

## Data Pipeline

**Key real-world constraint discovered during implementation**: Open-Meteo's
historical archive API (`archive-api.open-meteo.com`) never computes UV index
for any past date — confirmed by direct testing, it returns `null`
unconditionally. UV index is only available via the Forecast API's
`past_days` parameter, and only reliably for roughly the last ~75 days. So:

- **Backfill** (`scripts/backfill.js <city-id>`, run once per city, manually):
  fetches 5 years of temperature/wind/precipitation/humidity from the
  **Historical Weather (archive) API**; separately fetches whatever recent UV
  history is available (~75 days) from the **Forecast API** (`past_days=92`)
  and merges it in; separately fetches whatever PM10 history is available
  (in practice ~4 years for El Paso's coordinates) from the **Air Quality
  API** (hourly, aggregated to daily max). UV and AQI both start with partial
  history and grow by one day with each daily update — this is expected and
  by design, not a bug.
- **Daily update** (`scripts/update.js`, run by the GitHub Action): for each
  configured city, fetches the last few days (`past_days=3`, a buffer against
  a missed scheduled run) via the **Forecast API** (not archive — archive
  lags ~5 days and would return nulls for "yesterday") plus the Air Quality
  API, validates each value (non-null, plausible range, e.g. −20…55°C for
  temperature), appends new complete days, and trims each file independently
  to a 5-year rolling window.
  - **Retry**: up to 3 attempts with exponential backoff per fetch.
  - **Validation failure and retry exhaustion are both treated as a run
    failure** for weather data (exits non-zero, surfaced via a GitHub issue).
    AQI is treated as best-effort/secondary — a failure there is logged and
    skipped rather than failing the whole run.
- All values stored in metric units; imperial conversion happens client-side.
- The workflow runs `git pull --rebase` before pushing, to avoid failing on a
  concurrent commit to `main`.
- No API keys/secrets required anywhere in this pipeline.

## Multi-City Extensibility

Only El Paso is wired up, but `cities.config.js` + per-city-id data files
(`data/cities/<id>.json`, `<id>-aqi.json`) mean adding a city later is: add a
config entry, run `backfill.js <new-id>` once. The daily cron picks it up
automatically. The frontend does not have a city-switcher UI yet — deferred
until a second city actually exists.

## Frontend

- **Metric config** in `app.js` drives everything: 6 metrics (temperature —
  two series, high/low; UV, wind, precipitation, humidity, dust — one series
  each), each with unit conversion, decimal precision, and an accent color.
- **Charting**: ECharts (vendored locally), one instance per metric, using
  `type: 'time'` x-axes (not category — required since UV/AQI cover shorter
  date ranges than the other metrics and would misalign a shared category
  axis). Instances are kept in sync via `echarts.connect()` for their group,
  plus a manual absolute-timestamp zoom sync (`syncZoom()`) — necessary
  because percentage-based zoom sync would zoom differently-ranged datasets
  to different absolute date windows; verified working correctly in testing
  (a 30-day preset zoomed both the 5-year temperature series and the ~75-day
  UV series to the identical date window).
- **Desktop (≥768px)**: all 6 charts shown stacked, in the user's chosen
  order. **Mobile (<768px)**: one chart at a time via an underlined-text
  metric switcher; charts are lazily initialized on first display and resized
  on show, avoiding the zero-size-canvas problem of initializing inside a
  `display:none` container.
- **Reorder**: a "Customize" panel with up/down controls (not drag-and-drop)
  reorders the 6 metrics; persisted to `localStorage`, drives both desktop
  stack order and the mobile switcher.
- **Unit toggle**: one control, persisted to `localStorage`, switches
  °F+mph+in ↔ °C+km/h+mm across every chart/tooltip/summary figure at once.
- **Theme toggle**: light/dark, separate `localStorage` key.
- **Summary row**: highest, lowest, days ≥100°F/38°C, and longest heat
  streak — all for the active (zoomed) range, except the streak length itself
  is computed against the *full* dataset so a heatwave starting before the
  visible window still reports its true length. Each of the other 5 charts
  gets its own small period caption (max/total/average as appropriate).
- **Accessibility**: ECharts' built-in `aria: { show: true }` on every chart,
  plus a visually-hidden (`sr-only`, not `display:none`) `<table>` per metric
  with the currently-visible-range data, kept in sync with zoom.
- **Error state**: inline message if the JSON fetch fails, instead of a blank
  page — verified by testing with the data file temporarily removed.
- **Known font/canvas interaction**: canvas-rendered chart text (axis labels)
  does not get the same font-fallback behavior as DOM text — the self-hosted
  JetBrains Mono subset lacks glyphs for µ/³, so unit strings like "µg/m³"
  render as tofu on canvas even though they render fine in HTML. Resolution:
  units live in the (DOM) section heading/caption/tooltip, never on the
  (canvas) axis ticks, which show plain numbers only.

## Design System — "Desert Calm" (implemented)

The hour before sunrise in the Chihuahuan desert — muted, peaceful,
cool-toned — deliberately calmer than the extreme-heat data it displays.

**Palette** (both light and dark variants defined as CSS custom properties,
swapped via `prefers-color-scheme` and an explicit `data-theme` override):

| Token | Light | Dark |
|---|---|---|
| bg | `#C3CFBB` (Sage Ash) | `#242A22` (Night Sage) |
| surface | `#A9B79F` | `#1B1F19` |
| line (hairlines) | `#798D6A` | `#485343` |
| ink (text) | `#3E362E` | `#E8E4DA` |

All 6 accent colors (one per metric — including Humidity's "Haze Violet",
added after the original approved palette was found to have missed it) were
computed to ≥4.5:1 contrast against their respective backgrounds using an
actual WCAG contrast calculation, not eyeballed — the original approved
concept hexes measured as low as ~1.98:1 and were revised before
implementation.

**Type**: Bricolage Grotesque (display, self-hosted woff2), Public Sans
(body), JetBrains Mono (all numeric/data text). **Layout**: no cards/shadows —
hairline rules and small-caps section labels. **Signature**: a single
continuous-line SVG Franklin Mountains ridgeline, animates in via
`stroke-dashoffset` on load, respects `prefers-reduced-motion`.

## SEO (GitHub Pages, no custom domain)

Full pass implemented: title/description/canonical, Open Graph + Twitter Card
tags with a custom-generated `og-image.png`, JSON-LD `WebApplication` block,
`robots.txt` + `sitemap.xml`, favicon/apple-touch-icon/webmanifest, and a
cache-busting query param on the data JSON fetch (GitHub Pages' CDN can serve
stale JSON otherwise).

## Deployment & CI

- GitHub Pages: *Settings → Pages* → "Deploy from a branch" (`main`, root).
- *Settings → Actions → General → Workflow permissions* → "Read and write
  permissions" (needed for the daily commit-back and `gh issue create`).
- `.github/workflows/update-data.yml`: daily cron (12:00 UTC), runs
  `scripts/update.js`, commits/pushes changed data files, opens a GitHub
  issue on failure.

## Verification Performed

- Backfill run against the live Open-Meteo API: 1827 weather records,
  plausible value ranges, no `low_c > high_c` violations, 114 days ≥100°F,
  1469 AQI records (2022-08-03 onward), 74 UV records seeded from the
  forecast window.
- Retry and validation logic unit-tested directly (bad values correctly
  rejected; retry against an unreachable host correctly exhausts and fails).
- Full frontend tested via headless Chrome screenshots: desktop layout (all
  6 charts, synced zoom, presets), mobile layout (switcher, single chart),
  light and dark themes, unit toggle (verified correct °F↔°C conversion
  against displayed values), customize/reorder panel, and the error state
  (data file removed).
- Found and fixed two real bugs during testing: a grid `auto-fit`/`minmax`
  miscalculation cutting off the mobile summary row, and canvas font-fallback
  garbling the Dust chart's axis labels (see Frontend section above).
