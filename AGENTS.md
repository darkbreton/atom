# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Atom is a small browser app that loads a GPX or FIT running file and shows interval-by-interval statistics (pace, GAP, elevation gain, HR) plus a dynamic chart with zoom/selection. Pure client-side; no backend.

## Stack

- React 18 + Vite 5 (ES modules, `"type": "module"`)
- Recharts 3 for the line chart and brush
- `fit-file-parser` for `.fit`, native DOMParser for `.gpx`
- Plain CSS in [src/styles.css](src/styles.css) — no CSS framework, no preprocessor
- No TypeScript, no linter config, no test runner currently set up

## Commands

```bash
npm install        # install deps
npm run dev        # start Vite dev server (HMR)
npm run build      # production build → dist/
npm run preview    # preview the production build locally
```

There is no `lint` or `test` script. Don't invent one without asking.

## Layout

```
index.html              Vite entry, mounts #root
src/
  main.jsx              ReactDOM root, imports styles.css
  App.jsx               Single top-level component — all UI lives here
  styles.css            All styling (dark theme, mobile-first)
  lib/
    trackUtils.js       Pure helpers: parsing, segments, intervals, smoothing, stats
example/                Sample GPX/FIT files for manual testing
```

Two-file rule of thumb: UI state and layout in [src/App.jsx](src/App.jsx); anything that takes raw points/segments and returns derived data goes in [src/lib/trackUtils.js](src/lib/trackUtils.js).

## Data model (read this before changing parsing or interval logic)

- A **point** is `{ lat, lon, ele, time, hr }`. `time` is ms since epoch. `hr` may be `null`.
- A **segment** is the gap between two consecutive points: `{ distance, duration, elevGain, elevChange, hrTimeSum, hrDuration, startEle, endEle, pace, gap }`. Distances are meters, durations seconds, pace is seconds-per-km, gap is grade-adjusted pace.
- An **interval** is many segments grouped together: fixed distance (1 km, 2 km), fixed duration (5 min, 10 min), FIT-lap-based (`buildFitIntervals`), or auto-detected from pace (`detectAutoIntervals`). Interval options live in `intervalOptions` at the top of [src/lib/trackUtils.js](src/lib/trackUtils.js).
- **Chart data** is one row per point with cumulative `distance` plus the metric for that segment (pace/gap come from the *previous* segment, ele/hr from the point itself). `smoothChartData` adds a `smoothedValue` field using a distance-window moving average.

Pace and GAP are *inverted* on the Y axis (lower seconds-per-km = faster = visually higher). The current implementation swaps `domain` to `['dataMax', 'dataMin']`; this is known to be quirky in Recharts — prefer `YAxis reversed` when fixing it.

## Conventions

- **No comments** unless the *why* is non-obvious. Identifier names should carry the *what*.
- **No new dependencies** without a clear reason. The dep list is intentionally tiny.
- **Keep `App.jsx` flat** until it actually hurts. Extract a child component only when state or markup is genuinely reused.
- **Pure functions in `lib/`** — no React imports, no DOM access except inside `parseGPX` which needs `DOMParser`.
- **Units are explicit at the boundary**: helpers take/return SI (meters, seconds); formatters in [src/lib/trackUtils.js](src/lib/trackUtils.js) produce human strings.
- **Don't refactor unrelated code** while making a change.
- **Text in the UI is English** even though some legacy error strings are French; new strings should be English.

## Manual testing

There is no automated test suite. To verify changes:

1. `npm run dev`
2. Drop a file from `example/` (or your own `.gpx` / `.fit`) into the dropzone.
3. Exercise: interval picker, Y-axis metric, smoothing, brush selection, Enter-to-zoom, double-click-to-zoom-toggle, arrow keys to nudge the selection.
4. Resize to a phone width — the layout should still work.

If a change is purely in `lib/trackUtils.js` and would benefit from a test, ask before adding a test framework.

## Things to be careful about

- `.fit` lat/lon arrive in semicircles for some devices; `fitSemicircleToDegrees` handles the conversion — don't bypass it.
- `parseGPX` and `parseFit` both filter points missing lat/lon/ele/time. Don't loosen this without checking what breaks downstream (division-by-zero in segments, NaN propagation in stats).
- `computeStats` uses `Math.min(...values)` / `Math.max(...values)` — fine for current track sizes but will overflow the call stack for very large arrays. Refactor to a fold if you ever feed it 100k+ points.
- HR is averaged time-weighted, not sample-weighted. Preserve that when touching interval math.
- The chart's `Brush` controls *selection*, not zoom. Zoom is driven by `zoomWindow` state and Enter / double-click. Don't conflate them.

## Git

- Branch: `main`. There's only one commit so far (`Create index.html`), so don't assume an established commit-message style — short imperative subject is fine.
- Don't commit unless explicitly asked.
