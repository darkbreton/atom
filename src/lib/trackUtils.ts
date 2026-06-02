import FitParser from "fit-file-parser";

export type IntervalType = "distance" | "duration" | "laps";

export interface IntervalOption {
  label: string;
  type: IntervalType;
  value: number | null;
}

export type MetricKey = "pace" | "gap" | "ele" | "hr";

export interface MetricOption {
  label: string;
  key: MetricKey;
  unit: string;
}

export const intervalOptions: IntervalOption[] = [
  { label: "100m", type: "distance", value: 100 },
  { label: "1 km", type: "distance", value: 1000 },
  { label: "10s", type: "duration", value: 10 },
  { label: "30s", type: "duration", value: 30 },
  { label: "1 min", type: "duration", value: 60 },
  { label: "FIT laps", type: "laps", value: null },
];

export const metricOptions: MetricOption[] = [
  { label: "Pace", key: "pace", unit: "min/km" },
  { label: "GAP", key: "gap", unit: "min/km" },
  { label: "Elevation", key: "ele", unit: "m" },
  { label: "Heart rate", key: "hr", unit: "bpm" },
];

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${secs}`;
};

export const formatPace = (secondsPerKm: number): string => {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "--";
  return formatDuration(secondsPerKm);
};

export const formatNumber = (value: number, digits = 0): string => {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
};

export const formatMetric = (value: number, key: MetricKey): string => {
  if (key === "pace" || key === "gap") return formatPace(value);
  return formatNumber(value, key === "ele" ? 0 : 0);
};

export const formatDistance = (meters: number): string => {
  if (!Number.isFinite(meters)) return "--";
  return `${(meters / 1000).toFixed(2)} km`;
};

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number;
  time: number;
  hr: number | null;
}

export interface Segment {
  distance: number;
  duration: number;
  elevGain: number;
  elevChange: number;
  hrTimeSum: number;
  hrDuration: number;
  startEle: number;
  endEle: number;
  pace: number;
  gap: number;
}

export interface IntervalRow {
  index: number;
  duration: number;
  distance: number;
  startDistance: number;
  endDistance: number;
  pace: number;
  gap: number;
  elevationGain: number;
  avgHr: number;
}

export interface ChartPoint {
  time: number;
  distance: number;
  ele: number;
  hr: number | null;
  pace: number;
  gap: number;
}

export interface SmoothedChartPoint extends ChartPoint {
  smoothedValue: number;
}

export interface Stats {
  min: number;
  max: number;
  avg: number;
}

export interface StitchedTick {
  x: number;
  label: string;
}

export interface StitchedPoint extends SmoothedChartPoint {
  x: number;
  intervalIndex: number;
}

export interface StitchedData {
  stitched: StitchedPoint[];
  boundaries: number[];
  ticks: StitchedTick[];
  totalX: number;
}

interface ParsedFit {
  points: TrackPoint[];
  laps: FitLapRaw[];
}

export interface Tracks {
  points: TrackPoint[];
  segments: Segment[];
  fileName: string;
  fitLaps: FitLapRaw[];
}

export interface FitLapRaw {
  start_time?: string | Date;
  total_timer_time?: number;
  total_elapsed_time?: number;
  total_distance?: number;
  [key: string]: unknown;
}

const getDescendantByLocalName = (
  element: Element | null,
  names: string[],
): Element | null => {
  if (!element) return null;
  for (const child of Array.from(element.children)) {
    if (names.includes(child.localName.toLowerCase())) return child;
    const found = getDescendantByLocalName(child, names);
    if (found) return found;
  }
  return null;
};

const fitSemicircleToDegrees = (value: number): number => {
  if (!Number.isFinite(value)) return NaN;
  if (Math.abs(value) <= 180) return value;
  return value * (180 / 2 ** 31);
};

export const parseFit = async (
  arrayBuffer: ArrayBuffer,
): Promise<ParsedFit> => {
  const parser = new FitParser();
  const fit = await parser.parseAsync(arrayBuffer);
  const records = Array.isArray(fit.records) ? fit.records : [];

  const points: TrackPoint[] = records.map((record) => {
    const rawLat =
      (record.position_lat as number | undefined) ??
      (record.start_position_lat as number | undefined) ??
      (record.latitude as number | undefined) ??
      null;
    const rawLon =
      (record.position_long as number | undefined) ??
      (record.start_position_long as number | undefined) ??
      (record.longitude as number | undefined) ??
      null;
    const lat = fitSemicircleToDegrees(Number(rawLat));
    const lon = fitSemicircleToDegrees(Number(rawLon));
    const ele = Number(
      (record.altitude as number | undefined) ??
        (record.enhanced_altitude as number | undefined) ??
        (record.enhanced_avg_altitude as number | undefined) ??
        NaN,
    );
    const time = record.timestamp
      ? new Date(record.timestamp as string | Date).getTime()
      : NaN;
    const rawHr = record.heart_rate ?? record.hr ?? NaN;
    const hr = Number.isFinite(Number(rawHr)) ? Number(rawHr) : null;

    return { lat, lon, ele, time, hr };
  });

  const cleaned = points.filter(
    (pt) =>
      Number.isFinite(pt.lat) &&
      Number.isFinite(pt.lon) &&
      Number.isFinite(pt.ele) &&
      Number.isFinite(pt.time),
  );

  if (cleaned.length < 2) {
    throw new Error("Le FIT ne contient pas assez de points valides.");
  }

  return {
    points: cleaned.sort((a, b) => a.time - b.time),
    laps: Array.isArray(fit.laps) ? (fit.laps as FitLapRaw[]) : [],
  };
};

export const parseGPX = (text: string): TrackPoint[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Le GPX est invalide.");
  }

  const points: TrackPoint[] = Array.from(
    doc.getElementsByTagName("trkpt"),
  ).map((pt) => {
    const lat = parseFloat(pt.getAttribute("lat") ?? "NaN");
    const lon = parseFloat(pt.getAttribute("lon") ?? "NaN");
    const ele = parseFloat(
      getDescendantByLocalName(pt, ["ele"])?.textContent ?? "NaN",
    );
    const timeText = getDescendantByLocalName(pt, ["time"])?.textContent;
    const time = timeText ? new Date(timeText).getTime() : NaN;
    const hrRaw = parseInt(
      getDescendantByLocalName(pt, ["hr"])?.textContent ?? "",
      10,
    );

    return {
      lat,
      lon,
      ele,
      time,
      hr: Number.isFinite(hrRaw) ? hrRaw : null,
    };
  });

  const cleaned = points.filter(
    (pt) =>
      Number.isFinite(pt.lat) &&
      Number.isFinite(pt.lon) &&
      Number.isFinite(pt.ele) &&
      Number.isFinite(pt.time),
  );

  if (cleaned.length < 2) {
    throw new Error("Le GPX ne contient pas assez de points valides.");
  }

  return cleaned.sort((a, b) => a.time - b.time);
};

const toRadians = (value: number): number => (value * Math.PI) / 180;

const haversineDistance = (a: TrackPoint, b: TrackPoint): number => {
  const R = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const sq =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  return R * 2 * Math.atan2(Math.sqrt(sq), Math.sqrt(1 - sq));
};

export const buildSegments = (points: TrackPoint[]): Segment[] => {
  return points.slice(1).map((next, index) => {
    const prev = points[index];
    const distance = haversineDistance(prev, next);
    const duration = (next.time - prev.time) / 1000;
    const elevChange = next.ele - prev.ele;
    const elevGain = elevChange > 0 ? elevChange : 0;
    const pace =
      duration > 0 && distance > 0 ? duration / (distance / 1000) : NaN;
    const grade = distance > 0 ? elevChange / distance : 0;
    const gapFactor =
      1 + Math.max(0, grade * 100) * 0.03 + Math.min(0, grade * 100) * 0.01;
    const validPace = distance >= 1 ? pace : NaN;

    return {
      distance,
      duration,
      elevGain,
      elevChange,
      hrTimeSum:
        prev.hr != null && next.hr != null
          ? ((prev.hr + next.hr) / 2) * duration
          : 0,
      hrDuration: prev.hr != null && next.hr != null ? duration : 0,
      startEle: prev.ele,
      endEle: next.ele,
      pace: validPace,
      gap: Number.isFinite(validPace) ? validPace * gapFactor : NaN,
    };
  });
};

interface IntervalAccumulator {
  distance: number;
  duration: number;
  elevGain: number;
  hrTimeSum: number;
  hrDuration: number;
  startEle: number | null;
  endEle: number | null;
}

const createInterval = (): IntervalAccumulator => ({
  distance: 0,
  duration: 0,
  elevGain: 0,
  hrTimeSum: 0,
  hrDuration: 0,
  startEle: null,
  endEle: null,
});

const finalizeInterval = (
  interval: IntervalAccumulator,
  index: number,
  startDistance: number,
  endDistance: number,
): IntervalRow => {
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

const splitFixedIntervals = (
  segments: Segment[],
  option: IntervalOption,
): IntervalRow[] => {
  if (option.value == null) return [];
  const intervals: IntervalRow[] = [];
  let current = createInterval();
  let remaining = option.value;
  let currentStartEle: number | null = null;
  let lastEndEle: number | null = null;
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
      remaining = option.value ?? 0;
    }
  };

  for (const segment of segments) {
    let seg: Segment = { ...segment };
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

export const splitIntervals = (
  segments: Segment[],
  option: IntervalOption,
): IntervalRow[] => {
  // Fixed distance/duration splits are explicit. The "laps" option uses the
  // activity's FIT laps when available (handled by the caller via
  // buildFitIntervals); for tracks without laps (e.g. GPX) it falls back to a
  // deterministic 1 km split rather than auto-detecting work/recovery.
  if (option.type === "distance" || option.type === "duration") {
    return splitFixedIntervals(segments, option);
  }
  const oneKm = intervalOptions.find(
    (o) => o.type === "distance" && o.value === 1000,
  );
  return splitFixedIntervals(segments, oneKm ?? intervalOptions[0]);
};

const normalizeTimestamp = (value: string | Date | undefined): number =>
  value instanceof Date ? value.getTime() : new Date(value ?? 0).getTime();

export const buildFitIntervals = (
  points: TrackPoint[],
  segments: Segment[],
  laps: FitLapRaw[],
): IntervalRow[] => {
  if (!Array.isArray(laps) || laps.length === 0) return [];

  const cumDistanceAtSegmentEnd: number[] = [];
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
    let firstEle: number | null = null;
    let lastEle: number | null = null;
    let lapStartDistance: number | null = null;
    let lapEndDistance: number | null = null;

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

export const buildChartData = (
  points: TrackPoint[],
  segments: Segment[],
): ChartPoint[] => {
  let distance = 0;
  return points.map((point, index) => {
    const prevSegment = segments[index - 1];
    if (prevSegment) distance += prevSegment.distance;
    return {
      time: (point.time - points[0].time) / 1000,
      distance,
      ele: point.ele,
      hr: point.hr,
      pace: prevSegment?.pace ?? NaN,
      gap: prevSegment?.gap ?? NaN,
    };
  });
};

export const smoothChartData = (
  data: ChartPoint[],
  key: MetricKey,
  windowMeters: number,
): SmoothedChartPoint[] => {
  if (!windowMeters || windowMeters <= 0) {
    return data.map((item) => ({
      ...item,
      smoothedValue: item[key] as number,
    }));
  }

  const halfWindow = windowMeters / 2;
  const smoothed: SmoothedChartPoint[] = [];
  let windowStart = 0;

  for (let i = 0; i < data.length; i += 1) {
    const center = data[i].distance;
    while (
      windowStart < data.length &&
      data[windowStart].distance < center - halfWindow
    ) {
      windowStart += 1;
    }

    let sum = 0;
    let count = 0;
    for (
      let j = windowStart;
      j < data.length && data[j].distance <= center + halfWindow;
      j += 1
    ) {
      const value = data[j][key] as number;
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }

    smoothed.push({
      ...data[i],
      smoothedValue: count > 0 ? sum / count : (data[i][key] as number),
    });
  }

  return smoothed;
};

// Pace/gap are clamped to this band for the chart line only, so a slow stop
// (e.g. 20:00/km) doesn't blow up the axis scale; the real value is kept in
// `rawValue` for the stats.
const PACE_DISPLAY_MIN_S = 150;
const PACE_DISPLAY_MAX_S = 480;

const clampForChart = (value: number, key: MetricKey): number => {
  if (!Number.isFinite(value)) return value;
  if (key === "pace" || key === "gap") {
    return clamp(value, PACE_DISPLAY_MIN_S, PACE_DISPLAY_MAX_S);
  }
  return value;
};

export interface SmoothedStatPoint extends SmoothedChartPoint {
  // Real (unclamped) primary value, used for the min/avg/max stats.
  rawValue: number;
  // Clamped secondary-axis value, present only when a 2nd metric is shown.
  smoothedValue2?: number;
}

/**
 * Build the chart series: distance-smoothed primary (and optional secondary)
 * metric. `smoothedValue`/`smoothedValue2` are clamped for the line; `rawValue`
 * keeps the real primary value for the stats.
 */
export const buildSmoothedChartData = (
  points: TrackPoint[],
  segments: Segment[],
  primaryKey: MetricKey,
  secondaryKey: MetricKey | "off",
  smoothingMeters: number,
): SmoothedStatPoint[] => {
  const chartData = buildChartData(points, segments);
  if (!chartData.length) return [];
  const primary = smoothChartData(chartData, primaryKey, smoothingMeters);
  const secondary =
    secondaryKey !== "off"
      ? smoothChartData(chartData, secondaryKey, smoothingMeters)
      : null;
  return primary.map((point, i) => ({
    ...point,
    smoothedValue: clampForChart(point.smoothedValue, primaryKey),
    rawValue: point.smoothedValue,
    ...(secondary
      ? {
          smoothedValue2: clampForChart(
            secondary[i].smoothedValue,
            secondaryKey as MetricKey,
          ),
        }
      : {}),
  }));
};

export const computeStats = (
  data: ReadonlyArray<unknown>,
  key: string,
): Stats | null => {
  const values: number[] = [];
  for (const item of data) {
    const value = (item as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) values.push(value);
  }
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min, max, avg };
};

export interface RangeStatPoint {
  distance: number;
  // The real (unclamped) metric value at this point.
  value: number;
}

/**
 * min/avg/max over a contiguous range of points. min/max are the instantaneous
 * extremes (non-finite values ignored). The average is metric-aware and always
 * falls within [min, max]:
 *  - pace/gap: distance-weighted mean (= moving time / distance), so slower
 *    running counts proportionally to the ground it covers.
 *  - else (ele/hr): simple point mean (≈ time-weighted for ~1 Hz samples).
 */
export const rangeStats = (
  points: ReadonlyArray<RangeStatPoint>,
  key: MetricKey,
): Stats | null => {
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);

  let avg: number;
  if (key === "pace" || key === "gap") {
    let weighted = 0;
    let dist = 0;
    for (let i = 1; i < points.length; i += 1) {
      const v = points[i].value;
      const dd = points[i].distance - points[i - 1].distance;
      if (Number.isFinite(v) && dd > 0) {
        weighted += v * dd;
        dist += dd;
      }
    }
    avg = dist > 0 ? weighted / dist : NaN;
  } else {
    avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  return { min, avg, max };
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const parseTrackFromBuffer = async (
  arrayBuffer: ArrayBuffer,
  fileName: string,
): Promise<Tracks> => {
  const { points, laps } = await parseFit(arrayBuffer);
  return { points, segments: buildSegments(points), fileName, fitLaps: laps };
};

export const parseTrackFile = async (file: File): Promise<Tracks> => {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "fit") {
    return parseTrackFromBuffer(await file.arrayBuffer(), file.name);
  }
  const points = parseGPX(await file.text());
  return {
    points,
    segments: buildSegments(points),
    fileName: file.name,
    fitLaps: [],
  };
};

export interface PillClickModifiers {
  shiftKey: boolean;
  metaOrCtrlKey: boolean;
}

export interface PillClickResult {
  nextIndices: number[];
  nextAnchor: number | null;
}

export const resolvePillClick = (
  currentIndices: number[],
  anchor: number | null,
  clickedIndex: number,
  modifiers: PillClickModifiers,
): PillClickResult => {
  const { shiftKey, metaOrCtrlKey } = modifiers;

  if (shiftKey && anchor != null) {
    const lo = Math.min(anchor, clickedIndex);
    const hi = Math.max(anchor, clickedIndex);
    const range: number[] = [];
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

export const buildStitchedData = (
  chartData: SmoothedChartPoint[],
  intervals: IntervalRow[],
  selectedIndices: number[],
): StitchedData => {
  const sorted = [...selectedIndices].sort((a, b) => a - b);
  const stitched: StitchedPoint[] = [];
  const boundaries: number[] = [];
  const ticks: StitchedTick[] = [];
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
    ticks.push({
      x: xOffset + segmentLength / 2,
      label: String(interval.index),
    });
    xOffset += segmentLength;
    boundaries.push(xOffset);
  }

  boundaries.pop();
  return { stitched, boundaries, ticks, totalX: xOffset };
};
