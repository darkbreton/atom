# Chart & Intervals Redesign — Design Spec

Date: 2026-05-21
Status: Approved (pending spec review)

## Goal

Reshape the GPX/FIT analysis UI around the chart. The chart becomes the primary surface; intervals become a clickable navigation aid that drives the chart's zoom; selection within the chart drives min/avg/max. Mobile gets first-class touch support for selection.

## Scope

In scope:

- Page layout reorder (chart first, intervals second, upload last)
- New interval-pill navigation strip that controls zoom
- Multi-interval selection rendered as a stitched (non-contiguous) chart
- Fixing the pace/GAP Y-axis inversion
- Replacing the Recharts `Brush` with a custom drag-to-select interaction (mouse + two-finger touch)
- Moving the interval-mode picker into the intervals card; defaulting to FIT-laps/Auto

Out of scope:

- Map view, multi-file diff, exporting
- Changing parsing or interval math in [src/lib/trackUtils.js](../../../src/lib/trackUtils.js) — the pure helpers stay as-is
- A new test framework, linter, or TypeScript migration
- Persistence (selections reset when a new file is loaded)

## Layout (top-to-bottom)

Three cards. A card only renders when its data is available.

1. **Chart card** — only renders when `tracks` is loaded
2. **Intervals card** — only renders when `tracks` is loaded
3. **Upload card** — always rendered, now at the bottom

The page header (`Condensed running analysis` + the mobile chip) stays at the top. The interval-mode picker leaves the header.

## Chart card

Contents in order:

1. Header row: `H2` title, controls on the right
   - Y-axis metric dropdown (Pace / GAP / Elevation / Heart rate) — unchanged
   - Smoothing dropdown — unchanged
   - `Reset zoom` button — unchanged
   - `Clear selection` button — unchanged (now refers to the drag-selection, not the brush)
2. Summary row showing `Visible <range>` and `Selection: <range>` — unchanged in content
3. The chart itself
4. Stats row: `Visible values: min / avg / max` and `Selected values: min / avg / max` — unchanged
5. Footnote: replaced with "Drag on the chart (or two-finger drag on mobile) to measure a window. Press Enter to zoom in."

### Y-axis fix

Remove the `domain={['dataMax', 'dataMin']}` swap. Replace with the `reversed` prop on `<YAxis>` when `chartAxisKey === 'pace' || chartAxisKey === 'gap'`. Numeric domain stays `['dataMin', 'dataMax']` in all cases.

Tick formatting (`formatPace` for pace/gap, `formatNumber` otherwise) is unchanged.

### Multi-interval stitched chart

When zero or one interval is selected, the chart works exactly as today against a continuous `distance` axis.

When **two or more** intervals are selected:

- Build a synthetic dataset by concatenating, in pill order, the chart points whose `distance` falls inside each selected interval's `[start, end]` range.
- Each stitched point keeps its original `distance` (for tooltip display) but gets a new `x` field equal to its position along the stitched axis. `x` is what the X axis renders against.
- A thin `<ReferenceLine x={...} />` is drawn at each boundary between consecutive selected intervals.
- X-axis ticks show the interval number ("3", "5", "7") centered on each stitched segment, not km.
- The tooltip's `labelFormatter` falls back to showing the original distance ("km 3.42") when stitched, so the user still knows where each point comes from.
- Smoothing happens **before** stitching; smoothing across a stitch boundary would be wrong.

In single-interval-selected mode, the chart zooms to that interval but uses the normal continuous distance axis (no synthetic remap).

### Drag-to-select (replaces Brush)

The Recharts `<Brush>` element is removed.

Selection is captured by an invisible overlay layered on top of the chart's plot area. The overlay measures pointer X relative to itself and converts to a `distance` (or stitched `x`) value via the chart's X scale.

- **Desktop (mouse)**: on `pointerdown` with `pointerType === 'mouse'`, record the start X. On `pointermove` (with the button held), update the end X. On `pointerup`, commit the selection.
- **Mobile (touch)**: selection requires **two** active touches. Tracking starts when the second touch lands. The start X is the leftmost finger's X at touchstart; the end X is the rightmost finger's X. Selection updates as either finger moves. On `touchend`, commit the selection if at least one finger has moved more than ~6 px (otherwise discard — was probably a tap).
- A single-finger touch is **not** captured — `touchAction: 'pan-y'` on the overlay lets the page continue to scroll vertically.
- While dragging, render a `<ReferenceArea>` between start and end; on commit, the selection is persisted in `selectionRange` state and the stats row updates.
- Tapping or clicking outside the band (or pressing `Clear selection`) sets `selectionRange = null`.
- `Enter` still zooms into the current selection; arrow keys still nudge.

Hover-vs-drag coexistence: the overlay sits visually on top of the plot area but has `pointer-events: none` while idle so Recharts' tooltip continues to receive hover events. `pointerdown` is listened to on the **chart panel wrapper** (the existing `chartRef` div), not the overlay. When a press starts there, the handler calls `setPointerCapture` on the wrapper and the overlay flips to `pointer-events: auto` to track the drag visually. On `pointerup` it flips back. This way, the tooltip works during plain hover, and once a drag starts the tooltip is suspended (acceptable — the stats row replaces it).

## Intervals card

Contents in order:

1. Header row: `H2` title, controls on the right
   - Interval-mode picker (1 km / 2 km / 5 min / 10 min / FIT-laps / Auto) — **moved here from the page header**
   - `Show intervals` toggle — unchanged
2. Interval-pill strip — always visible inside this card (regardless of the table toggle)
3. Interval table — toggle-gated, content unchanged

### Default interval mode

Changes from `intervalOptions[0]` (1 km) to the FIT-laps/Auto option. The option already exists in `intervalOptions` and is handled by:

- `buildFitIntervals(...)` when the file has FIT laps
- `detectAutoIntervals(...)` (pace-based heuristic) when it doesn't

### Pill strip

A horizontal flex row, scrollable on overflow. Each pill renders the 1-based interval number — nothing else. Selected pills get an accent background. Pills are buttons with `aria-pressed` reflecting their selected state.

Pill click behavior (after stripping modifiers): the click resolves against `App.jsx` state `selectedIntervalIndices: number[]` (always kept sorted by interval index, which preserves pill order). `lastClickedIntervalIndex` is the anchor for shift-range.

- **Plain click** on pill `i`: `selectedIntervalIndices = [i]`, `lastClickedIntervalIndex = i`
- **Shift+click** on pill `i`: select the range `[min(anchor, i), max(anchor, i)]` inclusive, replacing the existing selection. If no anchor exists, treat as plain click.
- **Cmd/Ctrl+click** on pill `i`: toggle `i` in/out of `selectedIntervalIndices`. Set `lastClickedIntervalIndex = i`. (Cmd on Mac, Ctrl on Windows/Linux. Detected via `event.metaKey || event.ctrlKey`.)
- **Clicking an already-and-only selected pill**: deselects (returns to no selection / full zoom).
- **Reset zoom** button or clicking the chart's empty area: clears `selectedIntervalIndices`.

### Effect of pill selection on the chart

- 0 selected → `zoomWindow = [0, totalDistance]`, normal continuous axis
- 1 selected → `zoomWindow = [interval.start, interval.end]`, normal continuous axis
- ≥2 selected → chart switches to stitched mode (see above). `zoomWindow` is meaningless in this mode and is replaced by the stitched x-range.

The drag-to-select selection (`selectionRange`) clears whenever the pill selection changes.

Drag-to-select inside stitched mode is allowed — the band's start/end live in the synthetic `x` coordinate, and min/avg/max are computed over the stitched data subset. The stats row's "Selection: …" label shows interval-relative positions (e.g. `int 5 km 0.20 → int 7 km 0.80`) rather than a single km range.

`Reset zoom`, when stitched mode is active, clears `selectedIntervalIndices` (which also exits stitched mode). It also clears `selectionRange`.

### Interval start/end distances

Each finalized interval needs a `startDistance` and `endDistance` (cumulative meters along the track). `finalizeInterval` in [src/lib/trackUtils.js](../../../src/lib/trackUtils.js) currently does not return these. We extend it (and `buildFitIntervals`) to include `startDistance` and `endDistance`. This is the only change in `lib/` — purely additive, no existing call sites break.

## Upload card

Moves to the bottom. Otherwise unchanged. The interval-mode picker that used to live in this card's header is gone (moved to the intervals card).

## State model (App.jsx)

New / changed pieces of React state:

| State | Type | Notes |
|---|---|---|
| `intervalOption` | `IntervalOption` | Default changes from `intervalOptions[0]` to the auto option |
| `selectedIntervalIndices` | `number[]` | Always sorted ascending. `[]` = none. |
| `lastClickedIntervalIndex` | `number \| null` | Shift-range anchor. |
| `selectionRange` | `{ start, end } \| null` | Same as today, but populated by the drag interaction, not the brush. |
| `dragState` | internal | Tracks an in-progress drag; not React state if a ref is simpler. |

`zoomWindow` is retained for the 0-or-1-selected cases. In stitched mode it isn't used.

## Components

Keep `App.jsx` as the single top-level component for now. Extract these helpers as plain functions (no new component files yet):

- `buildStitchedData(chartData, selectedIntervals)` → `{ stitchedData, boundaries, tickPositions }`
- `resolvePillClick(currentIndices, anchor, clickedIndex, modifiers)` → `{ nextIndices, nextAnchor }` — pure, easy to unit-mentally-trace
- A `useDragSelection(ref, onCommit)` hook encapsulating the pointer/touch logic

If `App.jsx` exceeds roughly 600 lines after these changes, split out `<ChartPanel />` and `<IntervalsPanel />` then. Not before.

## Error handling

No new error paths. The existing `error` state and `setError` flow stays. Empty selection / no track loaded continue to short-circuit early.

## Testing (manual)

There is no test runner. Verify the following by hand against `example/` files:

- A `.fit` with multiple laps loads with FIT-laps/Auto as the default mode and pills 1..N appear.
- A `.gpx` (no laps) falls back to auto-detected intervals.
- Clicking a single pill zooms the chart to that interval; clicking again deselects.
- Shift-click on pill 5 then 8 selects 5..8 inclusive; the chart renders them stitched with interval-number ticks.
- Cmd+click on pill 7 within a 5..8 selection removes 7; the stitched chart drops the 7 panel and the divider lines update.
- Switching Y-axis to Pace puts fast paces at the top; same for GAP.
- Mouse drag on the chart creates a translucent band; releasing commits it; the stats row shows min/avg/max.
- On a phone (or DevTools mobile mode with two-finger emulation), two-finger drag creates the same band. Single-finger scrolling still works.
- Pressing Enter while a selection is active zooms into the selected window. Arrow keys nudge it.
- Reset zoom clears any pill selection and the stitched mode.
- Tooltip in stitched mode still shows the original km value.

## Risks

- **Two-finger gesture on iOS Safari** can be eaten by browser-level page-zoom. Set `touch-action: none` on the overlay's `pointerdown`-active state, but leave `touch-action: pan-y` when idle so the page scrolls.
- **Stitched-mode Recharts behavior**: drawing `ReferenceLine`s with the same `x` value as a data point works, but very narrow stitched segments (a single point) need a defensive width-minimum so the divider doesn't sit on top of the line.
- **Smoothing across stitch boundaries** would visibly leak data between unrelated intervals; we smooth first, then stitch, to avoid this.
- **Pointer events in Recharts**: tooltip relies on Recharts' own event listeners. The overlay stays `pointer-events: none` while idle (tooltip works); `pointerdown` is captured on the chart panel wrapper, and the overlay flips to `pointer-events: auto` only while a drag is in flight.
