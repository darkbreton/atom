# Chart & Intervals Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the GPX/FIT analysis UI so the chart is the primary surface, intervals become a clickable navigation strip that drives zoom (single & stitched multi-select), pace/GAP Y-axis inverts correctly, and selection on the chart works via mouse drag + two-finger touch.

**Architecture:** All UI state stays in [src/App.jsx](../../../src/App.jsx). Pure data transformations (interval start/end distances, stitched-data builder, pill-click resolution) go into [src/lib/trackUtils.js](../../../src/lib/trackUtils.js). The chart keeps using Recharts; we use Recharts' built-in `onMouseDown` / `onMouseMove` / `onMouseUp` for desktop selection and a hand-rolled touch handler on the chart wrapper for the two-finger gesture. The Recharts `<Brush>` is removed.

**Tech Stack:** React 18, Vite 5, Recharts 3, plain CSS. No TypeScript, no linter, **no test framework**. Per [AGENTS.md](../../../AGENTS.md), verification is manual against files in `example/`. Each task ends with a precise manual-test step; the engineer must perform it before committing.

---

## File map

- Modify: [src/lib/trackUtils.js](../../../src/lib/trackUtils.js) — extend interval shape with `startDistance` / `endDistance`; add `resolvePillClick`, `buildStitchedData` helpers
- Modify: [src/App.jsx](../../../src/App.jsx) — layout reorder, default interval, pills row, stitched mode, Y-axis fix, drag-to-select
- Modify: [src/styles.css](../../../src/styles.css) — pill styles, selection-band styling, mobile tweaks

No new files. No new dependencies.

---

## Task 1: Add `startDistance` / `endDistance` to every interval

**Files:**
- Modify: [src/lib/trackUtils.js](../../../src/lib/trackUtils.js) — `finalizeInterval`, `splitFixedIntervals`, `detectAutoIntervals`, `buildFitIntervals`

- [ ] **Step 1: Extend `finalizeInterval` to accept and return start/end distances**

Replace `finalizeInterval` (currently around lines 222-245) with:

```js
const finalizeInterval = (interval, index, startDistance, endDistance) => {
  const paceSeconds =
    interval.distance > 0
      ? interval.duration / (interval.distance / 1000)
      : NaN;
  const elevationChange =
    interval.endEle != null && interval.startEle != null
      ? interval.endEle - interval.startEle
      : 0;
  const grade = interval.distance > 0 ? elevationChange / interval.distance : 0;
  const gapFactor =
    1 + Math.max(0, grade * 100) * 0.03 + Math.min(0, grade * 100) * 0.01;

  return {
    index: index + 1,
    duration: interval.duration,
    distance: interval.distance,
    startDistance,
    endDistance,
    pace: paceSeconds,
    gap: paceSeconds * gapFactor,
    elevationGain: interval.elevGain,
    avgHr:
      interval.hrDuration > 0 ? interval.hrTimeSum / interval.hrDuration : NaN,
  };
};
```

- [ ] **Step 2: Track cumulative distance in `splitFixedIntervals`**

Replace `splitFixedIntervals` (currently around lines 247-316) with:

```js
const splitFixedIntervals = (segments, option) => {
  const intervals = [];
  let current = createInterval();
  let remaining = option.value;
  let currentStartEle = null;
  let lastEndEle = null;
  let cumulativeDistance = 0;
  let intervalStartDistance = 0;

  const flushCurrent = () => {
    if (current.distance > 0) {
      current.startEle = currentStartEle ?? current.startEle;
      current.endEle = lastEndEle ?? current.endEle;
      intervals.push(
        finalizeInterval(
          current,
          intervals.length,
          intervalStartDistance,
          cumulativeDistance,
        ),
      );
      intervalStartDistance = cumulativeDistance;
      current = createInterval();
      currentStartEle = null;
      lastEndEle = null;
      remaining = option.value;
    }
  };

  for (const segment of segments) {
    let seg = { ...segment };
    currentStartEle = currentStartEle ?? seg.startEle;

    while (seg.distance > 0 && seg.duration > 0) {
      const required = option.type === "distance" ? seg.distance : seg.duration;
      const ratio = Math.min(1, remaining / required);
      const part = {
        ...seg,
        distance: seg.distance * ratio,
        duration: seg.duration * ratio,
        elevGain: seg.elevGain * ratio,
        hrTimeSum: seg.hrTimeSum * ratio,
        hrDuration: seg.hrDuration * ratio,
      };

      current.distance += part.distance;
      current.duration += part.duration;
      current.elevGain += part.elevGain;
      current.hrTimeSum += part.hrTimeSum;
      current.hrDuration += part.hrDuration;
      current.startEle = current.startEle ?? part.startEle;
      current.endEle = part.endEle;
      lastEndEle = part.endEle;
      cumulativeDistance += part.distance;

      const consumed =
        option.type === "distance" ? part.distance : part.duration;
      remaining -= consumed;

      if (remaining <= 1e-6) {
        flushCurrent();
        if (ratio < 1) {
          const leftoverRatio = 1 - ratio;
          seg = {
            ...seg,
            distance: seg.distance * leftoverRatio,
            duration: seg.duration * leftoverRatio,
            elevGain: seg.elevGain * leftoverRatio,
            hrTimeSum: seg.hrTimeSum * leftoverRatio,
            hrDuration: seg.hrDuration * leftoverRatio,
          };
          continue;
        }
      }
      break;
    }
  }

  flushCurrent();
  return intervals;
};
```

- [ ] **Step 3: Track cumulative distance in `detectAutoIntervals`**

Replace `detectAutoIntervals` (currently around lines 318-380) with:

```js
const detectAutoIntervals = (segments) => {
  const paceValues = segments
    .map((segment) => segment.pace)
    .filter(Number.isFinite);
  if (paceValues.length === 0) {
    return splitFixedIntervals(segments, intervalOptions[0]);
  }

  const sorted = [...paceValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const workThreshold = median * 0.9;
  const recoveryThreshold = median * 1.08;

  const intervals = [];
  let current = createInterval();
  let currentStartEle = null;
  let lastEndEle = null;
  let isInWork = false;
  let cumulativeDistance = 0;
  let intervalStartDistance = 0;

  const flushCurrent = () => {
    if (
      current.distance > 0 &&
      (current.duration >= 20 || current.distance >= 200)
    ) {
      current.startEle = currentStartEle ?? current.startEle;
      current.endEle = lastEndEle ?? current.endEle;
      intervals.push(
        finalizeInterval(
          current,
          intervals.length,
          intervalStartDistance,
          intervalStartDistance + current.distance,
        ),
      );
    }
    current = createInterval();
    currentStartEle = null;
    lastEndEle = null;
    isInWork = false;
  };

  for (const segment of segments) {
    const isWork = segment.pace <= workThreshold;
    const isRecovery = segment.pace >= recoveryThreshold;

    if (isWork) {
      if (!isInWork) {
        isInWork = true;
        currentStartEle = segment.startEle;
        intervalStartDistance = cumulativeDistance;
      }
      current.distance += segment.distance;
      current.duration += segment.duration;
      current.elevGain += segment.elevGain;
      current.hrTimeSum += segment.hrTimeSum;
      current.hrDuration += segment.hrDuration;
      current.endEle = segment.endEle;
      lastEndEle = segment.endEle;
      cumulativeDistance += segment.distance;
      continue;
    }

    cumulativeDistance += segment.distance;

    if (isInWork && isRecovery) {
      flushCurrent();
    }
  }

  flushCurrent();
  return intervals.length
    ? intervals
    : splitFixedIntervals(segments, intervalOptions[0]);
};
```

- [ ] **Step 4: Add `startDistance` / `endDistance` to `buildFitIntervals`**

Replace `buildFitIntervals` (currently around lines 392-454) with:

```js
export const buildFitIntervals = (points, segments, laps) => {
  if (!Array.isArray(laps) || laps.length === 0) return [];

  const cumDistanceAtSegmentEnd = [];
  let cum = 0;
  for (const seg of segments) {
    cum += seg.distance;
    cumDistanceAtSegmentEnd.push(cum);
  }

  const sortedLaps = [...laps].sort(
    (a, b) =>
      normalizeTimestamp(a.start_time) - normalizeTimestamp(b.start_time),
  );

  return sortedLaps.map((lap, index) => {
    const startTime = normalizeTimestamp(lap.start_time);
    const duration = Number(
      lap.total_timer_time ?? lap.total_elapsed_time ?? 0,
    );
    const distance = Number(lap.total_distance ?? 0);
    const endTime = startTime + duration * 1000;

    const interval = createInterval();
    let firstEle = null;
    let lastEle = null;
    let lapStartDistance = null;
    let lapEndDistance = null;

    segments.forEach((segment, segmentIndex) => {
      const segmentStart = points[segmentIndex]?.time;
      const segmentEnd = points[segmentIndex + 1]?.time;
      if (segmentStart == null || segmentEnd == null) return;
      if (segmentStart >= startTime && segmentEnd <= endTime) {
        interval.distance += segment.distance;
        interval.duration += segment.duration;
        interval.elevGain += segment.elevGain;
        interval.hrTimeSum += segment.hrTimeSum;
        interval.hrDuration += segment.hrDuration;
        interval.startEle = interval.startEle ?? segment.startEle;
        interval.endEle = segment.endEle;
        firstEle = firstEle ?? segment.startEle;
        lastEle = segment.endEle;
        if (lapStartDistance == null) {
          lapStartDistance =
            cumDistanceAtSegmentEnd[segmentIndex] - segment.distance;
        }
        lapEndDistance = cumDistanceAtSegmentEnd[segmentIndex];
      }
    });

    interval.startEle = interval.startEle ?? firstEle;
    interval.endEle = interval.endEle ?? lastEle;

    const paceSeconds = distance > 0 ? duration / (distance / 1000) : NaN;
    const elevationChange =
      interval.endEle != null && interval.startEle != null
        ? interval.endEle - interval.startEle
        : 0;
    const grade = distance > 0 ? elevationChange / distance : 0;
    const gapFactor =
      1 + Math.max(0, grade * 100) * 0.03 + Math.min(0, grade * 100) * 0.01;

    return {
      index: index + 1,
      duration,
      distance,
      startDistance: lapStartDistance ?? 0,
      endDistance: lapEndDistance ?? distance,
      pace: paceSeconds,
      gap: Number.isFinite(paceSeconds) ? paceSeconds * gapFactor : NaN,
      elevationGain: interval.elevGain,
      avgHr:
        interval.hrDuration > 0
          ? interval.hrTimeSum / interval.hrDuration
          : NaN,
    };
  });
};
```

- [ ] **Step 5: Manual verify**

Run: `npm run dev`. Drop a `.fit` from `example/` into the dropzone. Open DevTools console and paste:

```js
const rows = document.querySelectorAll('tbody tr');
console.log('Open Show intervals first if empty. Rows:', rows.length);
```

Then in React DevTools (or by adding a temporary `console.log(intervalRows)` line in `App.jsx`, then reverting) confirm every entry has `startDistance` and `endDistance`, that the first interval's `startDistance` is `0`, and that consecutive intervals are non-overlapping with monotonically increasing distances.

Expected: every interval has `startDistance >= 0`, `endDistance > startDistance`, and `intervals[i].endDistance ≈ intervals[i+1].startDistance` for fixed-distance and FIT modes. (Auto-detect intervals may have gaps — that's fine; recovery sections are skipped on purpose.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/trackUtils.js
git commit -m "Add startDistance/endDistance to interval shape"
```

---

## Task 2: Fix pace / GAP Y-axis direction

**Files:**
- Modify: [src/App.jsx](../../../src/App.jsx) — the `<YAxis>` element

- [ ] **Step 1: Replace the YAxis element**

Find the `<YAxis ...>` block (currently around lines 334-337):

```jsx
<YAxis
  tickFormatter={(value) => (chartAxisKey === 'pace' || chartAxisKey === 'gap' ? formatPace(value) : formatNumber(value, chartAxisKey === 'ele' ? 0 : 0))}
  domain={chartAxisKey === 'pace' || chartAxisKey === 'gap' ? ['dataMax', 'dataMin'] : ['dataMin', 'dataMax']}
/>
```

Replace with:

```jsx
<YAxis
  reversed={chartAxisKey === 'pace' || chartAxisKey === 'gap'}
  tickFormatter={(value) => (chartAxisKey === 'pace' || chartAxisKey === 'gap' ? formatPace(value) : formatNumber(value, chartAxisKey === 'ele' ? 0 : 0))}
  domain={['dataMin', 'dataMax']}
/>
```

- [ ] **Step 2: Manual verify**

Run: `npm run dev`. Load a track. Switch Y-axis dropdown to `Pace`. Faster paces (e.g. `3:30`) must appear at the **top** of the Y axis and slower paces (e.g. `6:00`) at the **bottom**. Repeat for `GAP`. Switch to `Elevation` and `Heart rate` and confirm those stay in normal (low-at-bottom) orientation.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "Fix Y axis inversion for pace and GAP via reversed prop"
```

---

## Task 3: Reorder layout, move interval picker, default to Auto

**Files:**
- Modify: [src/App.jsx](../../../src/App.jsx) — JSX order, intervals card header, initial state

- [ ] **Step 1: Default intervalOption to FIT-laps / Auto**

Find (around line 44):

```jsx
const [intervalOption, setIntervalOption] = useState(intervalOptions[0]);
```

Replace with:

```jsx
const [intervalOption, setIntervalOption] = useState(
  intervalOptions.find((option) => option.type === 'auto') || intervalOptions[0],
);
```

- [ ] **Step 2: Remove the interval picker from the upload card header**

Find the upload card's `.section-header` (currently around lines 197-212):

```jsx
<div className="section-header">
  <div>
    <h2>Upload track</h2>
    <p>Drop a GPX or FIT file or tap to select one. The table updates by interval.</p>
  </div>
  <div className="select-wrap">
    <label htmlFor="interval">Interval</label>
    <select id="interval" value={intervalOption.label} onChange={(event) => setIntervalOption(intervalOptions.find((option) => option.label === event.target.value) || intervalOptions[0])}>
      {intervalOptions.map((option) => (
        <option key={option.label} value={option.label}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
</div>
```

Replace with:

```jsx
<div className="section-header">
  <div>
    <h2>Upload track</h2>
    <p>Drop a GPX or FIT file or tap to select one.</p>
  </div>
</div>
```

- [ ] **Step 3: Add the interval picker to the intervals card header**

Find the intervals card's `.section-header` (currently around lines 234-243):

```jsx
<div className="section-header">
  <div>
    <h2>Interval summary</h2>
    <p>Each row shows duration, distance, pace, GAP, elevation gain and HR.</p>
  </div>
  <button type="button" className="clear-button" onClick={() => setShowTable((prev) => !prev)}>
    {showTable ? 'Hide intervals' : 'Show intervals'}
  </button>
</div>
```

Replace with:

```jsx
<div className="section-header">
  <div>
    <h2>Intervals</h2>
    <p>Click an interval to zoom the chart. Shift-click to extend; Cmd/Ctrl-click to toggle.</p>
  </div>
  <div className="chart-controls">
    <div className="select-wrap">
      <label htmlFor="interval">Mode</label>
      <select
        id="interval"
        value={intervalOption.label}
        onChange={(event) =>
          setIntervalOption(
            intervalOptions.find((option) => option.label === event.target.value) ||
              intervalOptions[0],
          )
        }
      >
        {intervalOptions.map((option) => (
          <option key={option.label} value={option.label}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
    <button type="button" className="clear-button" onClick={() => setShowTable((prev) => !prev)}>
      {showTable ? 'Hide table' : 'Show table'}
    </button>
  </div>
</div>
```

- [ ] **Step 4: Reorder the card sections**

Find the `return ( ... )` body (around lines 186-371). The three cards currently render in this order: header, upload card, then (gated by `tracks`) intervals card + chart card.

Restructure so the order becomes: header, then (gated by `tracks`) chart card + intervals card, then upload card **always at the bottom**.

Concretely, the structure inside `<div className="app-shell">` becomes:

```jsx
<header className="top-bar"> ... unchanged ... </header>

{tracks ? (
  <>
    <section className="card">
      {/* CHART CARD — same content as today's chart card */}
    </section>

    <section className="card">
      {/* INTERVALS CARD — new header from Step 3, then the table block gated by showTable */}
    </section>
  </>
) : null}

<section className="card">
  {/* UPLOAD CARD — new header from Step 2, then dropzone + error banner */}
</section>
```

Keep all the existing chart-card and table contents verbatim while you move them. The only changes inside the chart and table blocks come in later tasks.

- [ ] **Step 5: Update the page header subtitle**

Find (around lines 188-194):

```jsx
<header className="top-bar">
  <div>
    <p className="eyebrow">GPX + FIT interval analysis</p>
    <h1>Condensed running analysis</h1>
  </div>
  <div className="chip">Mobile-friendly</div>
</header>
```

No change needed unless you'd like to drop the chip; leave as-is for now.

- [ ] **Step 6: Manual verify**

Run: `npm run dev`. Page should show only the upload card on first load (no chart/intervals card). Load a `.fit` from `example/`. Now the chart card appears first, intervals card second, upload card last. The interval-mode dropdown next to the intervals header should default to `FIT laps / Auto`. Switching it to `1 km` should re-bucket the table accordingly.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "Reorder cards (chart/intervals/upload) and move interval picker"
```

---

## Task 4: Single-click interval pills → zoom one interval

**Files:**
- Modify: [src/App.jsx](../../../src/App.jsx) — add pill state, render pills row inside intervals card, zoom on click
- Modify: [src/styles.css](../../../src/styles.css) — pill styles

- [ ] **Step 1: Add pill-selection state to App**

Near the other `useState` calls (around lines 42-49), add:

```jsx
const [selectedIntervalIndices, setSelectedIntervalIndices] = useState([]);
const [lastClickedIntervalIndex, setLastClickedIntervalIndex] = useState(null);
```

- [ ] **Step 2: Reset pill selection when tracks or interval mode change**

Find the `useEffect` that resets zoomWindow on `tracks` change (around lines 51-56):

```jsx
useEffect(() => {
  if (!tracks) return;
  const total = tracks.segments.reduce((sum, segment) => sum + segment.distance, 0);
  setZoomWindow([0, total]);
  setSelectionRange(null);
}, [tracks]);
```

Replace with:

```jsx
useEffect(() => {
  if (!tracks) return;
  const total = tracks.segments.reduce((sum, segment) => sum + segment.distance, 0);
  setZoomWindow([0, total]);
  setSelectionRange(null);
  setSelectedIntervalIndices([]);
  setLastClickedIntervalIndex(null);
}, [tracks]);
```

Also add a separate effect to reset pills when interval mode changes (since indices no longer line up):

```jsx
useEffect(() => {
  setSelectedIntervalIndices([]);
  setLastClickedIntervalIndex(null);
  setSelectionRange(null);
}, [intervalOption]);
```

- [ ] **Step 3: Drive zoom from selected pills (single-select case only)**

Add a new effect that runs whenever the pill selection or intervalRows change:

```jsx
useEffect(() => {
  if (!intervalRows.length || !totalDistance) return;
  if (selectedIntervalIndices.length === 0) {
    setZoomWindow([0, totalDistance]);
    setSelectionRange(null);
    return;
  }
  if (selectedIntervalIndices.length === 1) {
    const row = intervalRows[selectedIntervalIndices[0]];
    if (row && Number.isFinite(row.startDistance) && Number.isFinite(row.endDistance)) {
      setZoomWindow([row.startDistance, row.endDistance]);
      setSelectionRange(null);
    }
  }
  // Multi-select handled in Task 5
}, [selectedIntervalIndices, intervalRows, totalDistance]);
```

- [ ] **Step 4: Render the pills row inside the intervals card**

Inside the intervals `<section className="card">` (the one moved into place in Task 3), immediately after its `<div className="section-header">…</div>`, add:

```jsx
{intervalRows.length > 0 && (
  <div className="interval-pills" role="group" aria-label="Intervals">
    {intervalRows.map((row, idx) => {
      const selected = selectedIntervalIndices.includes(idx);
      return (
        <button
          key={idx}
          type="button"
          className={`interval-pill${selected ? ' is-selected' : ''}`}
          aria-pressed={selected}
          onClick={() => {
            if (selected && selectedIntervalIndices.length === 1) {
              setSelectedIntervalIndices([]);
              setLastClickedIntervalIndex(null);
            } else {
              setSelectedIntervalIndices([idx]);
              setLastClickedIntervalIndex(idx);
            }
          }}
        >
          {row.index}
        </button>
      );
    })}
  </div>
)}
```

This handles plain-click only. Shift- and Cmd/Ctrl-click come in Task 5.

- [ ] **Step 5: Add pill styles**

At the end of [src/styles.css](../../../src/styles.css), append:

```css
.interval-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
  padding-bottom: 0.2rem;
  overflow-x: auto;
}

.interval-pill {
  min-width: 2.5rem;
  height: 2.5rem;
  padding: 0 0.65rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.7);
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.interval-pill:hover {
  background: rgba(59, 130, 246, 0.12);
}

.interval-pill.is-selected {
  background: rgba(59, 130, 246, 0.28);
  border-color: rgba(59, 130, 246, 0.6);
  color: #e0eaff;
}

.interval-pill:focus-visible {
  outline: 2px solid rgba(125, 211, 252, 0.7);
  outline-offset: 2px;
}
```

- [ ] **Step 6: Manual verify**

Run: `npm run dev`. Load a `.fit`. The intervals card shows a row of numbered pills (`1`, `2`, …). Click pill `3`: the chart zooms to that interval's distance range; the "Visible km → km" summary reflects that range; the table doesn't need to be open. Click pill `3` again: full track shows again. Click pill `5`: jumps to interval 5. Switch interval mode to `1 km`: pills reset (none selected) and re-number to match the new bucketing.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "Add clickable interval pills that zoom the chart"
```

---

## Task 5: Multi-select pills + stitched-chart mode

**Files:**
- Modify: [src/lib/trackUtils.js](../../../src/lib/trackUtils.js) — export `resolvePillClick`, `buildStitchedData`
- Modify: [src/App.jsx](../../../src/App.jsx) — use both helpers, render stitched chart for ≥2 selections

- [ ] **Step 1: Add `resolvePillClick` helper**

At the end of [src/lib/trackUtils.js](../../../src/lib/trackUtils.js) (after `clamp`), append:

```js
export const resolvePillClick = (currentIndices, anchor, clickedIndex, modifiers) => {
  const { shiftKey, metaOrCtrlKey } = modifiers;

  if (shiftKey && anchor != null) {
    const lo = Math.min(anchor, clickedIndex);
    const hi = Math.max(anchor, clickedIndex);
    const range = [];
    for (let i = lo; i <= hi; i += 1) range.push(i);
    return { nextIndices: range, nextAnchor: anchor };
  }

  if (metaOrCtrlKey) {
    const set = new Set(currentIndices);
    if (set.has(clickedIndex)) set.delete(clickedIndex);
    else set.add(clickedIndex);
    return {
      nextIndices: [...set].sort((a, b) => a - b),
      nextAnchor: clickedIndex,
    };
  }

  if (currentIndices.length === 1 && currentIndices[0] === clickedIndex) {
    return { nextIndices: [], nextAnchor: null };
  }
  return { nextIndices: [clickedIndex], nextAnchor: clickedIndex };
};
```

- [ ] **Step 2: Add `buildStitchedData` helper**

Right after `resolvePillClick`, append:

```js
export const buildStitchedData = (chartData, intervals, selectedIndices) => {
  const sorted = [...selectedIndices].sort((a, b) => a - b);
  const stitched = [];
  const boundaries = [];
  const ticks = [];
  let xOffset = 0;

  for (const idx of sorted) {
    const interval = intervals[idx];
    if (!interval) continue;
    const segment = chartData.filter(
      (point) =>
        point.distance >= interval.startDistance &&
        point.distance <= interval.endDistance,
    );
    if (!segment.length) continue;

    const segmentStartDist = segment[0].distance;
    const segmentEndDist = segment[segment.length - 1].distance;
    const segmentLength = segmentEndDist - segmentStartDist;

    for (const point of segment) {
      stitched.push({
        ...point,
        x: xOffset + (point.distance - segmentStartDist),
        intervalIndex: interval.index,
      });
    }
    ticks.push({ x: xOffset + segmentLength / 2, label: String(interval.index) });
    xOffset += segmentLength;
    boundaries.push(xOffset);
  }

  boundaries.pop();
  return { stitched, boundaries, ticks, totalX: xOffset };
};
```

- [ ] **Step 3: Import the new helpers in App.jsx**

Find the import block at the top (around lines 13-30):

```jsx
import {
  intervalOptions,
  metricOptions,
  formatDuration,
  formatDistance,
  formatMetric,
  formatPace,
  formatNumber,
  parseFit,
  parseGPX,
  buildSegments,
  buildFitIntervals,
  splitIntervals,
  buildChartData,
  smoothChartData,
  computeStats,
  clamp,
} from './lib/trackUtils';
```

Add `resolvePillClick` and `buildStitchedData` to the import list (just inside the closing brace):

```jsx
import {
  intervalOptions,
  metricOptions,
  formatDuration,
  formatDistance,
  formatMetric,
  formatPace,
  formatNumber,
  parseFit,
  parseGPX,
  buildSegments,
  buildFitIntervals,
  splitIntervals,
  buildChartData,
  smoothChartData,
  computeStats,
  clamp,
  resolvePillClick,
  buildStitchedData,
} from './lib/trackUtils';
```

- [ ] **Step 4: Use `resolvePillClick` in the pill onClick**

Replace the `onClick` handler from Task 4 Step 4:

```jsx
onClick={() => {
  if (selected && selectedIntervalIndices.length === 1) {
    setSelectedIntervalIndices([]);
    setLastClickedIntervalIndex(null);
  } else {
    setSelectedIntervalIndices([idx]);
    setLastClickedIntervalIndex(idx);
  }
}}
```

With:

```jsx
onClick={(event) => {
  const { nextIndices, nextAnchor } = resolvePillClick(
    selectedIntervalIndices,
    lastClickedIntervalIndex,
    idx,
    { shiftKey: event.shiftKey, metaOrCtrlKey: event.metaKey || event.ctrlKey },
  );
  setSelectedIntervalIndices(nextIndices);
  setLastClickedIntervalIndex(nextAnchor);
}}
```

- [ ] **Step 5: Compute stitched data in App**

Below the existing `chartDataWithSmoothing` memo (around lines 102-105), add:

```jsx
const stitchedMode = selectedIntervalIndices.length >= 2;

const stitched = useMemo(() => {
  if (!stitchedMode) return null;
  return buildStitchedData(chartDataWithSmoothing, intervalRows, selectedIntervalIndices);
}, [stitchedMode, chartDataWithSmoothing, intervalRows, selectedIntervalIndices]);
```

- [ ] **Step 6: Replace `visibleData` to handle stitched mode**

Find the `visibleData` memo (around lines 133-136):

```jsx
const visibleData = useMemo(() => {
  if (!chartDataWithSmoothing.length) return [];
  return chartDataWithSmoothing.filter((point) => point.distance >= zoomWindow[0] && point.distance <= zoomWindow[1]);
}, [chartDataWithSmoothing, zoomWindow]);
```

Replace with:

```jsx
const visibleData = useMemo(() => {
  if (stitchedMode && stitched) return stitched.stitched;
  if (!chartDataWithSmoothing.length) return [];
  return chartDataWithSmoothing.filter(
    (point) => point.distance >= zoomWindow[0] && point.distance <= zoomWindow[1],
  );
}, [stitchedMode, stitched, chartDataWithSmoothing, zoomWindow]);
```

- [ ] **Step 7: Update the visible-range label for stitched mode**

Find (around line 181):

```jsx
const visibleRangeLabel = `${formatDistance(zoomWindow[0])} → ${formatDistance(zoomWindow[1])}`;
```

Replace with:

```jsx
const visibleRangeLabel = stitchedMode
  ? `stitched: ${selectedIntervalIndices.map((i) => intervalRows[i]?.index).filter(Boolean).join(', ')}`
  : `${formatDistance(zoomWindow[0])} → ${formatDistance(zoomWindow[1])}`;
```

- [ ] **Step 8: Make the `<XAxis>` switch to the synthetic axis in stitched mode**

Find the `<XAxis>` element (currently around line 333):

```jsx
<XAxis dataKey="distance" tickFormatter={(value) => `${(value / 1000).toFixed(2)} km`} type="number" domain={["dataMin", "dataMax"]} />
```

Replace with:

```jsx
<XAxis
  dataKey={stitchedMode ? 'x' : 'distance'}
  type="number"
  domain={stitchedMode && stitched ? [0, stitched.totalX] : ['dataMin', 'dataMax']}
  ticks={stitchedMode && stitched ? stitched.ticks.map((t) => t.x) : undefined}
  tickFormatter={
    stitchedMode && stitched
      ? (value) => {
          const tick = stitched.ticks.find((t) => Math.abs(t.x - value) < 0.5);
          return tick ? `int ${tick.label}` : '';
        }
      : (value) => `${(value / 1000).toFixed(2)} km`
  }
/>
```

- [ ] **Step 9: Draw boundary lines between stitched intervals**

Add `ReferenceLine` to the recharts import (currently around lines 2-12):

```jsx
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Brush,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
```

Inside the `<LineChart>` JSX, immediately after the `<Line ... />` element (around line 346), add:

```jsx
{stitchedMode && stitched && stitched.boundaries.map((x) => (
  <ReferenceLine key={x} x={x} stroke="rgba(255,255,255,0.22)" strokeDasharray="3 3" />
))}
```

- [ ] **Step 10: Make the tooltip understand stitched points**

Find the `<Tooltip>` element (currently around lines 338-345). Replace it with:

```jsx
<Tooltip
  wrapperStyle={{ backgroundColor: 'rgba(7, 12, 22, 0.96)', border: '1px solid rgba(255,255,255,0.12)', color: '#e7eef8', borderRadius: '12px', padding: '0.75rem' }}
  contentStyle={{ backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }}
  labelStyle={{ color: '#9bb3d8', fontSize: '0.85rem' }}
  itemStyle={{ color: '#e7eef8', fontSize: '0.95rem' }}
  labelFormatter={(value, payload) => {
    const point = payload?.[0]?.payload;
    if (stitchedMode && point && point.intervalIndex != null) {
      return `int ${point.intervalIndex} · ${(point.distance / 1000).toFixed(2)} km`;
    }
    return `${(value / 1000).toFixed(2)} km`;
  }}
  formatter={(value) => (chartAxisKey === 'pace' || chartAxisKey === 'gap' ? formatPace(value) : formatNumber(value, chartAxisKey === 'ele' ? 0 : 0))}
/>
```

- [ ] **Step 11: Make Reset zoom clear pill selection too**

Find the `Reset zoom` button (around line 315):

```jsx
<button type="button" className="clear-button" onClick={() => setZoomWindow([0, totalDistance])}>
  Reset zoom
</button>
```

Replace with:

```jsx
<button
  type="button"
  className="clear-button"
  onClick={() => {
    setSelectedIntervalIndices([]);
    setLastClickedIntervalIndex(null);
    setZoomWindow([0, totalDistance]);
    setSelectionRange(null);
  }}
>
  Reset zoom
</button>
```

- [ ] **Step 12: Manual verify**

Run: `npm run dev`. Load a `.fit` with multiple laps.

- Click pill `2`, then **shift+click** pill `5`: pills 2 through 5 highlight, chart shows them stitched in order with thin dashed dividers between them. X-axis ticks show `int 2`, `int 3`, `int 4`, `int 5`. Hovering a point shows `int N · X.XX km` in the tooltip label.
- **Cmd-click** (Mac) / **Ctrl-click** (Linux/Windows) on pill `4` while 2-5 selected: pill 4 toggles off, the chart redraws with intervals 2,3,5 stitched and dividers between 3 and 5.
- Click pill `1` (no modifier): selection becomes only `1`, chart returns to normal (non-stitched) zoom for that interval.
- Click `Reset zoom`: full track shows, no pills selected.
- "Visible" summary reads `stitched: 2, 3, 5` when in stitched mode.

- [ ] **Step 13: Commit**

```bash
git add src/lib/trackUtils.js src/App.jsx
git commit -m "Stitched multi-interval chart and modifier-key pill selection"
```

---

## Task 6: Replace `<Brush>` with desktop mouse-drag selection

**Files:**
- Modify: [src/App.jsx](../../../src/App.jsx) — remove Brush, add drag handlers on LineChart

- [ ] **Step 1: Add drag state to App**

Near the other `useState`/`useRef` declarations, add:

```jsx
const dragStartRef = useRef(null);
const [isDragging, setIsDragging] = useState(false);
```

- [ ] **Step 2: Remove the `<Brush>` JSX and `handleBrushChange`**

Delete the `handleBrushChange` function (currently around lines 146-151):

```jsx
const handleBrushChange = (brush) => {
  if (!brush || brush.startIndex == null || brush.endIndex == null) return;
  const start = visibleData[brush.startIndex]?.distance ?? zoomWindow[0];
  const end = visibleData[brush.endIndex]?.distance ?? zoomWindow[1];
  setSelectionRange({ start, end });
};
```

Delete the `<Brush ... />` element (currently around line 350):

```jsx
<Brush dataKey="distance" height={26} stroke="#7dd3fc" travellerWidth={10} tickFormatter={(value) => `${(value / 1000).toFixed(2)} km`} onChange={handleBrushChange} />
```

Remove `Brush` from the recharts import block.

- [ ] **Step 3: Wire mouse drag on `<LineChart>`**

Locate the `<LineChart data={visibleData} margin={...}>` element (around line 331). Replace its opening tag with:

```jsx
<LineChart
  data={visibleData}
  margin={{ top: 12, right: 18, left: 18, bottom: 0 }}
  onMouseDown={(event) => {
    if (!event || event.activeLabel == null) return;
    dragStartRef.current = event.activeLabel;
    setIsDragging(true);
    setSelectionRange({ start: event.activeLabel, end: event.activeLabel });
  }}
  onMouseMove={(event) => {
    if (!isDragging || !event || event.activeLabel == null) return;
    const start = dragStartRef.current;
    const end = event.activeLabel;
    setSelectionRange({
      start: Math.min(start, end),
      end: Math.max(start, end),
    });
  }}
  onMouseUp={() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (selectionRange && selectionRange.end - selectionRange.start < 1) {
      setSelectionRange(null);
    }
  }}
  onMouseLeave={() => {
    if (isDragging) setIsDragging(false);
  }}
>
```

- [ ] **Step 4: Update chart-note text**

Find (around line 366):

```jsx
<div className="chart-note">Select with the brush, then press Enter to zoom the selected window.</div>
```

Replace with:

```jsx
<div className="chart-note">
  Drag on the chart (or two-finger drag on mobile) to measure a window. Press Enter to zoom into it.
</div>
```

- [ ] **Step 5: Manual verify**

Run: `npm run dev`. Load a track. **Click and drag horizontally** on the chart: a translucent band appears between the press start and the current pointer, and the "Selected values" stats below show min/avg/max for that window. Release: the band stays. Press **Enter**: the chart zooms into that window. Press a couple of arrow keys: the band nudges. Click `Clear selection`: the band disappears.

The Brush UI must be gone. The tooltip on plain hover (no mouse button) must still work.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "Replace Brush with mouse-drag selection on the chart"
```

---

## Task 7: Two-finger touch drag selection (mobile)

**Files:**
- Modify: [src/App.jsx](../../../src/App.jsx) — add touch handlers on the chart wrapper

- [ ] **Step 1: Add a helper to convert touch X to chart-X value**

Inside the `App` function body, near the existing `handleChartDoubleClick` (around line 153), add:

```jsx
const touchToChartX = (clientX) => {
  if (!chartRef.current) return null;
  const svg = chartRef.current.querySelector('svg');
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const leftInset = 78;
  const rightInset = 18;
  const plotLeft = rect.left + leftInset;
  const plotWidth = rect.width - leftInset - rightInset;
  if (plotWidth <= 0) return null;
  const fraction = clamp((clientX - plotLeft) / plotWidth, 0, 1);
  let xMin;
  let xMax;
  if (stitchedMode && stitched) {
    xMin = 0;
    xMax = stitched.totalX;
  } else {
    xMin = zoomWindow[0];
    xMax = zoomWindow[1];
  }
  return xMin + fraction * (xMax - xMin);
};
```

(`leftInset = 78` covers the LineChart's 18px left margin plus Recharts' default Y-axis width of 60px. If your chart looks visibly offset, adjust this constant.)

- [ ] **Step 2: Add a ref to track in-progress touch selection**

Near the other refs/state, add:

```jsx
const touchStartRef = useRef(null);
```

- [ ] **Step 3: Attach touch handlers to the chart wrapper**

Find the chart wrapper (around line 329):

```jsx
<div className="chart-panel" ref={chartRef} onDoubleClick={handleChartDoubleClick}>
```

Replace with:

```jsx
<div
  className="chart-panel"
  ref={chartRef}
  onDoubleClick={handleChartDoubleClick}
  onTouchStart={(event) => {
    if (event.touches.length !== 2) return;
    const x1 = touchToChartX(event.touches[0].clientX);
    const x2 = touchToChartX(event.touches[1].clientX);
    if (x1 == null || x2 == null) return;
    touchStartRef.current = { startX1: x1, startX2: x2 };
    setSelectionRange({ start: Math.min(x1, x2), end: Math.max(x1, x2) });
    event.preventDefault();
  }}
  onTouchMove={(event) => {
    if (!touchStartRef.current || event.touches.length !== 2) return;
    const x1 = touchToChartX(event.touches[0].clientX);
    const x2 = touchToChartX(event.touches[1].clientX);
    if (x1 == null || x2 == null) return;
    setSelectionRange({ start: Math.min(x1, x2), end: Math.max(x1, x2) });
    event.preventDefault();
  }}
  onTouchEnd={(event) => {
    if (!touchStartRef.current) return;
    if (event.touches.length < 2) {
      touchStartRef.current = null;
    }
  }}
  onTouchCancel={() => {
    touchStartRef.current = null;
  }}
>
```

The `event.preventDefault()` on touchstart/touchmove suppresses native two-finger page-zoom while the user is selecting. Single-finger touches are untouched (the handlers no-op when `touches.length !== 2`), so vertical scrolling still works.

- [ ] **Step 4: Add `touch-action` styling on the chart wrapper**

In [src/styles.css](../../../src/styles.css), find `.chart-panel` (around line 238):

```css
.chart-panel {
  margin-top: 1rem;
  border-radius: 28px;
  overflow: hidden;
  background: rgba(11, 16, 32, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.12);
}
```

Replace with:

```css
.chart-panel {
  margin-top: 1rem;
  border-radius: 28px;
  overflow: hidden;
  background: rgba(11, 16, 32, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.12);
  touch-action: pan-y;
}
```

`touch-action: pan-y` tells the browser one-finger touches scroll vertically (preserved page scrolling), while multi-finger and horizontal gestures are handed to our JS handlers.

- [ ] **Step 5: Manual verify (desktop emulation)**

Run: `npm run dev`. Open Chrome DevTools, toggle device-toolbar (mobile), and enable touch emulation. Hold `Shift` and drag with the mouse — Chrome emulates a two-finger pinch. The selection band should appear in real time, and releasing locks it in. Single-finger touch (no shift) should let you scroll the page vertically.

If you have a phone or tablet, hit the local dev URL and confirm with real fingers: two-finger horizontal drag selects, one finger still scrolls.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "Add two-finger touch drag to select a chart window on mobile"
```

---

## Task 8: Cleanup pass

**Files:**
- Modify: [src/App.jsx](../../../src/App.jsx) — remove `chart-summary` for stitched mode if useless, prune unused
- Modify: [src/styles.css](../../../src/styles.css) — collapse duplicated rules already present in the file

- [ ] **Step 1: Verify no unused imports remain**

Check the recharts import block. After Task 6 removed `Brush`, ensure it isn't present. Confirm `ReferenceArea` and `ReferenceLine` ARE present (used for selection band and stitched dividers). Any other unused — remove.

- [ ] **Step 2: Trim duplicated CSS**

Open [src/styles.css](../../../src/styles.css). The current file declares `.stats-row`, `.stat-label`, `.stat-value`, `.clear-button`, and `.chart-note` **twice** (around lines 274-297 vs 299-336). Delete the second copies; keep the first. This is a pure dedupe — visual output should be identical.

- [ ] **Step 3: Manual verify**

Run: `npm run dev`. Walk through the full flow once: load a `.fit`, switch interval mode, click pills, shift- and cmd-click for multi-select, drag-to-select on the chart, press Enter to zoom in, arrow keys to nudge, Reset zoom, Clear selection, switch Y-axis metric (verify pace/GAP inversion), switch smoothing. Confirm nothing has regressed.

Also drop a `.gpx` (no laps): the auto-detect mode should produce pills based on the pace heuristic, and they should still drive zoom.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "Clean up unused imports and duplicated CSS rules"
```

---

## Self-review notes

- Every spec section has a corresponding task: Y-axis fix (Task 2), layout reorder + interval picker move + Auto default (Task 3), pill row (Tasks 4-5), stitched chart (Task 5), drag-to-select with mouse + two-finger touch (Tasks 6-7), Reset-zoom-clears-pills (Task 5 Step 11), drag-selection-in-stitched-mode (covered by Task 7 Step 1's `touchToChartX` reading `stitched.totalX`).
- `startDistance` / `endDistance` are produced consistently by every interval source (fixed-distance, fixed-duration, auto-detect, FIT laps) — Task 1 hits all four.
- `resolvePillClick` is the single source of truth for shift/cmd modifier logic; the App.jsx wiring (Task 5 Step 4) passes both modifier flags from the React event.
- `buildStitchedData` keeps original `distance` on each point so the tooltip can show the real km even with the synthetic X axis.
- Smoothing runs before stitching: `stitched` is computed from `chartDataWithSmoothing`, not raw `chartData`.
- No new dependencies, no new test framework (per spec scope).
