import FitParser from "fit-file-parser";

export const intervalOptions = [
  { label: "1 km", type: "distance", value: 1000 },
  { label: "2 km", type: "distance", value: 2000 },
  { label: "5 min", type: "duration", value: 300 },
  { label: "10 min", type: "duration", value: 600 },
  { label: "FIT laps / Auto", type: "auto", value: null },
];

export const metricOptions = [
  { label: "Pace", key: "pace", unit: "min/km" },
  { label: "GAP", key: "gap", unit: "min/km" },
  { label: "Elevation", key: "ele", unit: "m" },
  { label: "Heart rate", key: "hr", unit: "bpm" },
];

export const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${secs}`;
};

export const formatPace = (secondsPerKm) => {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "--";
  return formatDuration(secondsPerKm);
};

export const formatNumber = (value, digits = 0) => {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
};

export const formatMetric = (value, key) => {
  if (key === "pace" || key === "gap") return formatPace(value);
  return formatNumber(value, key === "ele" ? 0 : 0);
};

export const formatDistance = (meters) => {
  if (!Number.isFinite(meters)) return "--";
  return `${(meters / 1000).toFixed(2)} km`;
};

const getDescendantByLocalName = (element, names) => {
  if (!element) return null;
  for (const child of element.children) {
    if (names.includes(child.localName.toLowerCase())) return child;
    const found = getDescendantByLocalName(child, names);
    if (found) return found;
  }
  return null;
};

const fitSemicircleToDegrees = (value) => {
  if (!Number.isFinite(value)) return NaN;
  if (Math.abs(value) <= 180) return value;
  return value * (180 / 2 ** 31);
};

export const parseFit = async (arrayBuffer) => {
  const parser = new FitParser();
  const fit = await parser.parseAsync(arrayBuffer);
  const records = Array.isArray(fit.records) ? fit.records : [];

  const points = records.map((record) => {
    const rawLat =
      record.position_lat ??
      record.start_position_lat ??
      record.latitude ??
      null;
    const rawLon =
      record.position_long ??
      record.start_position_long ??
      record.longitude ??
      null;
    const lat = fitSemicircleToDegrees(Number(rawLat));
    const lon = fitSemicircleToDegrees(Number(rawLon));
    const ele = Number(
      record.altitude ??
        record.enhanced_altitude ??
        record.enhanced_avg_altitude ??
        NaN,
    );
    const time = record.timestamp ? new Date(record.timestamp).getTime() : NaN;
    const hr = Number.isFinite(Number(record.heart_rate ?? record.hr ?? NaN))
      ? Number(record.heart_rate ?? record.hr)
      : null;

    return {
      lat,
      lon,
      ele,
      time,
      hr,
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
    throw new Error("Le FIT ne contient pas assez de points valides.");
  }

  return {
    points: cleaned.sort((a, b) => a.time - b.time),
    laps: Array.isArray(fit.laps) ? fit.laps : [],
  };
};

export const parseGPX = (text) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Le GPX est invalide.");
  }

  const points = Array.from(doc.getElementsByTagName("trkpt")).map((pt) => {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    const ele = parseFloat(
      getDescendantByLocalName(pt, ["ele"])?.textContent ?? "NaN",
    );
    const timeText = getDescendantByLocalName(pt, ["time"])?.textContent;
    const time = timeText ? new Date(timeText).getTime() : NaN;
    const hr = parseInt(
      getDescendantByLocalName(pt, ["hr"])?.textContent ?? "",
      10,
    );

    return {
      lat,
      lon,
      ele,
      time,
      hr: Number.isFinite(hr) ? hr : null,
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

const toRadians = (value) => (value * Math.PI) / 180;

const haversineDistance = (a, b) => {
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

export const buildSegments = (points) => {
  return points.slice(1).map((next, index) => {
    const prev = points[index];
    const distance = haversineDistance(prev, next);
    const duration = (next.time - prev.time) / 1000;
    const elevChange = next.ele - prev.ele;
    const elevGain = elevChange > 0 ? elevChange : 0;
    const pace =
      duration > 0 && distance > 0 ? duration / (distance / 1000) : NaN;
    const elevationChange = next.ele - prev.ele;
    const grade = distance > 0 ? elevationChange / distance : 0;
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

const createInterval = () => ({
  distance: 0,
  duration: 0,
  elevGain: 0,
  hrTimeSum: 0,
  hrDuration: 0,
  startEle: null,
  endEle: null,
});

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

export const splitIntervals = (segments, option) => {
  if (option.type === "auto") {
    return detectAutoIntervals(segments);
  }
  return splitFixedIntervals(segments, option);
};

const normalizeTimestamp = (value) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

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

export const buildChartData = (points, segments) => {
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

export const smoothChartData = (data, key, windowMeters) => {
  if (!windowMeters || windowMeters <= 0) {
    return data.map((item) => ({ ...item, smoothedValue: item[key] }));
  }

  const halfWindow = windowMeters / 2;
  const smoothed = [];
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
      const value = data[j][key];
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }

    smoothed.push({
      ...data[i],
      smoothedValue: count > 0 ? sum / count : data[i][key],
    });
  }

  return smoothed;
};

export const computeStats = (data, key) => {
  const values = data.map((item) => item[key]).filter(Number.isFinite);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min, max, avg };
};

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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
