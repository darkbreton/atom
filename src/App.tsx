import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, MouseEvent, TouchEvent } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import {
  intervalOptions,
  metricOptions,
  formatDuration,
  formatDistance,
  formatMetric,
  formatPace,
  formatNumber,
  buildFitIntervals,
  splitIntervals,
  buildChartData,
  smoothChartData,
  computeStats,
  clamp,
  resolvePillClick,
  buildStitchedData,
  parseTrackFile,
  parseTrackFromBuffer,
} from "./lib/trackUtils";
import type {
  ChartPoint,
  IntervalOption,
  IntervalRow,
  MetricKey,
  MetricOption,
  SmoothedChartPoint,
  Tracks,
} from "./lib/trackUtils";
import { useDrive } from "./lib/useDrive";

const DRIVE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as
  | string
  | undefined;
const DRIVE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const DRIVE_FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID as
  | string
  | undefined;
const PACE_CLAMP_MIN_S = 150;
const PACE_CLAMP_MAX_S = 480;

interface SmoothingOption {
  label: string;
  value: number;
}

const smoothingOptions: SmoothingOption[] = [
  { label: "Off", value: 0 },
  { label: "10 m", value: 10 },
  { label: "25 m", value: 25 },
  { label: "50 m", value: 50 },
  { label: "100 m", value: 100 },
];

interface Range {
  start: number;
  end: number;
}

interface ChartPointWithFormatted extends ChartPoint {
  formattedDistance: string;
}

export default function App() {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string>("");
  const [tracks, setTracks] = useState<Tracks | null>(null);
  const [intervalOption, setIntervalOption] = useState<IntervalOption>(
    intervalOptions.find((option) => option.type === "auto") ||
      intervalOptions[0],
  );
  const [chartAxisKey, setChartAxisKey] = useState<MetricKey>(
    metricOptions[0].key,
  );
  const [chartAxisKey2, setChartAxisKey2] = useState<MetricKey | 'off'>('off');

  useEffect(() => {
    if (chartAxisKey2 !== 'off' && chartAxisKey2 === chartAxisKey) {
      setChartAxisKey2('off');
    }
  }, [chartAxisKey, chartAxisKey2]);
  const [smoothingOption, setSmoothingOption] = useState<SmoothingOption>(
    smoothingOptions[1],
  );
  const [zoomWindow, setZoomWindow] = useState<[number, number]>([0, 0]);
  const [selectionRange, setSelectionRange] = useState<Range | null>(null);
  const [showTable, setShowTable] = useState<boolean>(false);
  const [selectedIntervalIndices, setSelectedIntervalIndices] = useState<
    number[]
  >([]);
  const [lastClickedIntervalIndex, setLastClickedIntervalIndex] = useState<
    number | null
  >(null);
  const dragStartRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ startX1: number; startX2: number } | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const loadTracksFromBuffer = async (
    bytes: ArrayBuffer,
    fileName: string,
  ): Promise<void> => {
    setError("");
    try {
      setTracks(await parseTrackFromBuffer(bytes, fileName));
    } catch (err) {
      setTracks(null);
      setError(
        err instanceof Error ? err.message : "Erreur de lecture du fichier.",
      );
    }
  };

  const drive = useDrive({
    clientId: DRIVE_CLIENT_ID,
    apiKey: DRIVE_API_KEY,
    folderId: DRIVE_FOLDER_ID,
    onFileBytes: loadTracksFromBuffer,
  });

  useEffect(() => {
    if (!tracks) return;
    const total = tracks.segments.reduce(
      (sum, segment) => sum + segment.distance,
      0,
    );
    setZoomWindow([0, total]);
    setSelectionRange(null);
    setSelectedIntervalIndices([]);
    setLastClickedIntervalIndex(null);
  }, [tracks]);

  useEffect(() => {
    setSelectedIntervalIndices([]);
    setLastClickedIntervalIndex(null);
    setSelectionRange(null);
  }, [intervalOption]);

  const handleFile = async (file: File): Promise<void> => {
    setError("");
    try {
      setTracks(await parseTrackFile(file));
    } catch (err) {
      setTracks(null);
      setError(
        err instanceof Error ? err.message : "Erreur de lecture du fichier.",
      );
    }
  };

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (file) await handleFile(file);
  };

  const autoIntervalOption = useMemo(
    () => intervalOptions.find((option) => option.type === 'auto') || intervalOptions[0],
    [],
  );

  const chartIntervalRows: IntervalRow[] = useMemo(() => {
    if (!tracks) return [];
    if (tracks.fitLaps.length > 0) {
      return buildFitIntervals(tracks.points, tracks.segments, tracks.fitLaps);
    }
    return splitIntervals(tracks.segments, autoIntervalOption);
  }, [tracks, autoIntervalOption]);

  const tableIntervalRows: IntervalRow[] = useMemo(() => {
    if (!tracks) return [];
    if (tracks.fitLaps.length > 0 && intervalOption.type === 'auto') {
      return buildFitIntervals(tracks.points, tracks.segments, tracks.fitLaps);
    }
    return splitIntervals(tracks.segments, intervalOption);
  }, [tracks, intervalOption]);

  const chartData: ChartPointWithFormatted[] = useMemo(() => {
    if (!tracks) return [];
    return buildChartData(tracks.points, tracks.segments).map((point) => ({
      ...point,
      formattedDistance: formatDistance(point.distance),
    }));
  }, [tracks]);

  const clampForKey = (value: number, key: MetricKey): number => {
    if (!Number.isFinite(value)) return value;
    if (key === 'pace' || key === 'gap') {
      return clamp(value, PACE_CLAMP_MIN_S, PACE_CLAMP_MAX_S);
    }
    return value;
  };

  const chartDataWithSmoothing: SmoothedChartPoint[] = useMemo(() => {
    if (!chartData.length) return [];
    const primary = smoothChartData(chartData, chartAxisKey, smoothingOption.value);
    const secondary =
      chartAxisKey2 !== 'off'
        ? smoothChartData(chartData, chartAxisKey2, smoothingOption.value)
        : null;
    return primary.map((point, i) => ({
      ...point,
      smoothedValue: clampForKey(point.smoothedValue, chartAxisKey),
      ...(secondary
        ? { smoothedValue2: clampForKey(secondary[i].smoothedValue, chartAxisKey2 as MetricKey) }
        : {}),
    }));
  }, [chartData, chartAxisKey, chartAxisKey2, smoothingOption]);

  const stitchedMode = selectedIntervalIndices.length >= 2;

  const stitched = useMemo(() => {
    if (!stitchedMode) return null;
    return buildStitchedData(
      chartDataWithSmoothing,
      chartIntervalRows,
      selectedIntervalIndices,
    );
  }, [
    stitchedMode,
    chartDataWithSmoothing,
    chartIntervalRows,
    selectedIntervalIndices,
  ]);

  const totalDistance = chartDataWithSmoothing.length
    ? chartDataWithSmoothing[chartDataWithSmoothing.length - 1].distance
    : 0;

  useEffect(() => {
    if (!selectionRange || !totalDistance) return;
    const step = Math.max(
      3,
      (selectionRange.end - selectionRange.start) * 0.05,
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const span = selectionRange.end - selectionRange.start;
        const nextStart = clamp(
          selectionRange.start + direction * step,
          0,
          Math.max(0, totalDistance - span),
        );
        setSelectionRange({ start: nextStart, end: nextStart + span });
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        setZoomWindow([selectionRange.start, selectionRange.end]);
        setSelectionRange(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionRange, totalDistance]);

  useEffect(() => {
    if (!chartIntervalRows.length || !totalDistance) return;
    if (selectedIntervalIndices.length === 0) {
      setZoomWindow([0, totalDistance]);
      setSelectionRange(null);
      return;
    }
    if (selectedIntervalIndices.length === 1) {
      const row = chartIntervalRows[selectedIntervalIndices[0]];
      if (
        row &&
        Number.isFinite(row.startDistance) &&
        Number.isFinite(row.endDistance)
      ) {
        setZoomWindow([row.startDistance, row.endDistance]);
        setSelectionRange(null);
      }
    }
  }, [selectedIntervalIndices, chartIntervalRows, totalDistance]);

  const visibleData: SmoothedChartPoint[] = useMemo(() => {
    if (stitchedMode && stitched) return stitched.stitched;
    if (!chartDataWithSmoothing.length) return [];
    return chartDataWithSmoothing.filter(
      (point) =>
        point.distance >= zoomWindow[0] && point.distance <= zoomWindow[1],
    );
  }, [stitchedMode, stitched, chartDataWithSmoothing, zoomWindow]);

  const visibleStats = useMemo(
    () => computeStats(visibleData, "smoothedValue"),
    [visibleData],
  );

  const selectionStats = useMemo(() => {
    if (!selectionRange) return null;
    const selected = chartDataWithSmoothing.filter(
      (point) =>
        point.distance >= selectionRange.start &&
        point.distance <= selectionRange.end,
    );
    return computeStats(selected, "smoothedValue");
  }, [chartDataWithSmoothing, selectionRange]);

  const touchToChartX = (clientX: number): number | null => {
    if (!chartRef.current) return null;
    const svg = chartRef.current.querySelector("svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const leftInset = 78;
    const rightInset = 18;
    const plotLeft = rect.left + leftInset;
    const plotWidth = rect.width - leftInset - rightInset;
    if (plotWidth <= 0) return null;
    const fraction = clamp((clientX - plotLeft) / plotWidth, 0, 1);
    let xMin: number;
    let xMax: number;
    if (stitchedMode && stitched) {
      xMin = 0;
      xMax = stitched.totalX;
    } else {
      xMin = zoomWindow[0];
      xMax = zoomWindow[1];
    }
    return xMin + fraction * (xMax - xMin);
  };

  const handleChartDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!chartRef.current || !totalDistance) return;
    const rect = chartRef.current.getBoundingClientRect();
    const xNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const clicked = zoomWindow[0] + xNorm * (zoomWindow[1] - zoomWindow[0]);

    if (zoomWindow[0] === 0 && zoomWindow[1] === totalDistance) {
      const windowSize = Math.max(100, totalDistance * 0.3);
      const start = clamp(
        clicked - windowSize / 2,
        0,
        totalDistance - windowSize,
      );
      setZoomWindow([start, Math.min(start + windowSize, totalDistance)]);
      setSelectionRange(null);
    } else {
      setZoomWindow([0, totalDistance]);
      setSelectionRange(null);
    }
  };

  const clearSelection = (): void => setSelectionRange(null);

  const intervalDistance = tableIntervalRows.reduce(
    (acc, row) => acc + row.distance,
    0,
  );
  const intervalDuration = tableIntervalRows.reduce(
    (acc, row) => acc + row.duration,
    0,
  );
  const totalPace =
    intervalDistance > 0 ? intervalDuration / (intervalDistance / 1000) : NaN;
  const totalGap =
    intervalDistance > 0
      ? tableIntervalRows.reduce((acc, row) => acc + row.gap * row.distance, 0) /
        intervalDistance
      : NaN;
  const totalHr =
    tableIntervalRows.reduce(
      (acc, row) =>
        acc + (Number.isFinite(row.avgHr) ? row.avgHr * row.duration : 0),
      0,
    ) /
    Math.max(
      1,
      tableIntervalRows.reduce(
        (acc, row) => acc + (Number.isFinite(row.avgHr) ? row.duration : 0),
        0,
      ),
    );

  const chartMetric: MetricOption =
    metricOptions.find((option) => option.key === chartAxisKey) ||
    metricOptions[0];
  const visibleRangeLabel = stitchedMode
    ? `stitched: ${selectedIntervalIndices
        .map((i) => chartIntervalRows[i]?.index)
        .filter(Boolean)
        .join(", ")}`
    : `${formatDistance(zoomWindow[0])} → ${formatDistance(zoomWindow[1])}`;
  const selectionLabel = selectionRange
    ? `${formatDistance(selectionRange.start)} → ${formatDistance(selectionRange.end)}`
    : null;
  const visibleStatsText = visibleStats
    ? `${formatMetric(visibleStats.min, chartAxisKey)} / ${formatMetric(
        visibleStats.avg,
        chartAxisKey,
      )} / ${formatMetric(visibleStats.max, chartAxisKey)}`
    : "--";
  const selectionStatsText = selectionStats
    ? `${formatMetric(selectionStats.min, chartAxisKey)} / ${formatMetric(
        selectionStats.avg,
        chartAxisKey,
      )} / ${formatMetric(selectionStats.max, chartAxisKey)}`
    : "--";

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">GPX + FIT interval analysis</p>
          <h1>Condensed running analysis</h1>
        </div>
        <div className="chip">Mobile-friendly</div>
      </header>

      {tracks ? (
        <>
          <section className="card">
            <div className="section-header">
              <div>
                <h2>Dynamic chart</h2>
                <p>
                  Pick a metric, drag on the chart to select, then press Enter
                  to zoom.
                </p>
              </div>
              <div className="chart-controls">
                <div className="select-wrap">
                  <label htmlFor="chart-axis">Y axis</label>
                  <select
                    id="chart-axis"
                    value={chartAxisKey}
                    onChange={(event) =>
                      setChartAxisKey(event.target.value as MetricKey)
                    }
                  >
                    {metricOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="select-wrap">
                  <label htmlFor="chart-axis-2">Y2 (right)</label>
                  <select
                    id="chart-axis-2"
                    value={chartAxisKey2}
                    onChange={(event) =>
                      setChartAxisKey2(event.target.value as MetricKey | 'off')
                    }
                  >
                    <option value="off">Off</option>
                    {metricOptions
                      .filter((option) => option.key !== chartAxisKey)
                      .map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="select-wrap">
                  <label htmlFor="smoothing">Smoothing</label>
                  <select
                    id="smoothing"
                    value={smoothingOption.label}
                    onChange={(event) =>
                      setSmoothingOption(
                        smoothingOptions.find(
                          (option) => option.label === event.target.value,
                        ) || smoothingOptions[0],
                      )
                    }
                  >
                    {smoothingOptions.map((option) => (
                      <option key={option.label} value={option.label}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
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
                <button
                  type="button"
                  className="clear-button"
                  onClick={clearSelection}
                >
                  Clear selection
                </button>
              </div>
            </div>

            <div className="chart-summary">
              <div>Visible {visibleRangeLabel}</div>
              {selectionRange && <div>Selection: {selectionLabel}</div>}
            </div>

            <div
              className="chart-panel"
              ref={chartRef}
              onDoubleClick={handleChartDoubleClick}
              onTouchStart={(event: TouchEvent<HTMLDivElement>) => {
                if (event.touches.length !== 2) return;
                const x1 = touchToChartX(event.touches[0].clientX);
                const x2 = touchToChartX(event.touches[1].clientX);
                if (x1 == null || x2 == null) return;
                touchStartRef.current = { startX1: x1, startX2: x2 };
                setSelectionRange({
                  start: Math.min(x1, x2),
                  end: Math.max(x1, x2),
                });
                event.preventDefault();
              }}
              onTouchMove={(event: TouchEvent<HTMLDivElement>) => {
                if (!touchStartRef.current || event.touches.length !== 2)
                  return;
                const x1 = touchToChartX(event.touches[0].clientX);
                const x2 = touchToChartX(event.touches[1].clientX);
                if (x1 == null || x2 == null) return;
                setSelectionRange({
                  start: Math.min(x1, x2),
                  end: Math.max(x1, x2),
                });
                event.preventDefault();
              }}
              onTouchEnd={(event: TouchEvent<HTMLDivElement>) => {
                if (!touchStartRef.current) return;
                if (event.touches.length < 2) {
                  touchStartRef.current = null;
                }
              }}
              onTouchCancel={() => {
                touchStartRef.current = null;
              }}
            >
              <ResponsiveContainer
                width="100%"
                height={320}
                style={{ userSelect: "none" }}
              >
                <LineChart
                  data={visibleData}
                  margin={{ top: 12, right: 18, left: 18, bottom: 0 }}
                  onMouseDown={(
                    event: { activeLabel?: number | string } | null,
                  ) => {
                    if (!event || event.activeLabel == null) return;
                    const label = Number(event.activeLabel);
                    if (!Number.isFinite(label)) return;
                    dragStartRef.current = label;
                    setIsDragging(true);
                    setSelectionRange({ start: label, end: label });
                  }}
                  onMouseMove={(
                    event: { activeLabel?: number | string } | null,
                  ) => {
                    if (!isDragging || !event || event.activeLabel == null)
                      return;
                    const start = dragStartRef.current;
                    if (start == null) return;
                    const end = Number(event.activeLabel);
                    if (!Number.isFinite(end)) return;
                    setSelectionRange({
                      start: Math.min(start, end),
                      end: Math.max(start, end),
                    });
                  }}
                  onMouseUp={() => {
                    if (!isDragging) return;
                    setIsDragging(false);
                    if (
                      selectionRange &&
                      selectionRange.end - selectionRange.start < 1
                    ) {
                      setSelectionRange(null);
                    }
                  }}
                  onMouseLeave={() => {
                    if (isDragging) setIsDragging(false);
                  }}
                >
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.08)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey={stitchedMode ? "x" : "distance"}
                    type="number"
                    domain={
                      stitchedMode && stitched
                        ? [0, stitched.totalX]
                        : ["dataMin", "dataMax"]
                    }
                    ticks={
                      stitchedMode && stitched
                        ? stitched.ticks.map((t) => t.x)
                        : undefined
                    }
                    tickFormatter={
                      stitchedMode && stitched
                        ? (value: number) => {
                            const tick = stitched.ticks.find(
                              (t) => Math.abs(t.x - value) < 0.5,
                            );
                            return tick ? `int ${tick.label}` : "";
                          }
                        : (value: number) => `${(value / 1000).toFixed(2)} km`
                    }
                  />
                  <YAxis
                    yAxisId="left"
                    reversed={chartAxisKey === "pace" || chartAxisKey === "gap"}
                    tickFormatter={(value: number) =>
                      chartAxisKey === "pace" || chartAxisKey === "gap"
                        ? formatPace(value)
                        : formatNumber(value, chartAxisKey === "ele" ? 0 : 0)
                    }
                    domain={["dataMin", "dataMax"]}
                    stroke="#7dd3fc"
                  />
                  {chartAxisKey2 !== 'off' && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      reversed={chartAxisKey2 === 'pace' || chartAxisKey2 === 'gap'}
                      tickFormatter={(value: number) =>
                        chartAxisKey2 === 'pace' || chartAxisKey2 === 'gap'
                          ? formatPace(value)
                          : formatNumber(value, chartAxisKey2 === 'ele' ? 0 : 0)
                      }
                      domain={['dataMin', 'dataMax']}
                      stroke="#facc15"
                    />
                  )}
                  <Tooltip
                    wrapperStyle={{
                      backgroundColor: "rgba(7, 12, 22, 0.96)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "#e7eef8",
                      borderRadius: "12px",
                      padding: "0.75rem",
                    }}
                    contentStyle={{
                      backgroundColor: "transparent",
                      border: "none",
                      boxShadow: "none",
                    }}
                    labelStyle={{ color: "#9bb3d8", fontSize: "0.85rem" }}
                    itemStyle={{ color: "#e7eef8", fontSize: "0.95rem" }}
                    labelFormatter={
                      ((
                        label: unknown,
                        payload: ReadonlyArray<{
                          payload?: {
                            intervalIndex?: number;
                            distance?: number;
                          };
                        }>,
                      ) => {
                        const point = payload?.[0]?.payload;
                        if (
                          stitchedMode &&
                          point &&
                          point.intervalIndex != null &&
                          point.distance != null
                        ) {
                          return `int ${point.intervalIndex} · ${(point.distance / 1000).toFixed(2)} km`;
                        }
                        const num =
                          typeof label === "number" ? label : Number(label);
                        return Number.isFinite(num)
                          ? `${(num / 1000).toFixed(2)} km`
                          : "";
                      }) as never
                    }
                    formatter={
                      ((
                        value: unknown,
                        _name: unknown,
                        item: { dataKey?: string } | undefined,
                      ) => {
                        const num =
                          typeof value === "number" ? value : Number(value);
                        if (!Number.isFinite(num)) return "--";
                        const key =
                          item?.dataKey === "smoothedValue2" &&
                          chartAxisKey2 !== "off"
                            ? (chartAxisKey2 as MetricKey)
                            : chartAxisKey;
                        return key === "pace" || key === "gap"
                          ? formatPace(num)
                          : formatNumber(num, key === "ele" ? 0 : 0);
                      }) as never
                    }
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="smoothedValue"
                    name={chartMetric.label}
                    stroke="#7dd3fc"
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                    animationDuration={0}
                  />
                  {chartAxisKey2 !== 'off' && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="smoothedValue2"
                      name={
                        metricOptions.find((o) => o.key === chartAxisKey2)?.label ?? ''
                      }
                      stroke="#facc15"
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                      animationDuration={0}
                    />
                  )}
                  {stitchedMode &&
                    stitched &&
                    stitched.boundaries.map((x) => (
                      <ReferenceLine
                        key={x}
                        x={x}
                        stroke="rgba(255,255,255,0.22)"
                        strokeDasharray="3 3"
                      />
                    ))}
                  {selectionRange && (
                    <ReferenceArea
                      x1={selectionRange.start}
                      x2={selectionRange.end}
                      stroke="rgba(59, 130, 246, 0.4)"
                      fill="rgba(59, 130, 246, 0.12)"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="stats-row">
              <div>
                <div className="stat-label">Visible values</div>
                <div className="stat-value">
                  {visibleStatsText} {chartMetric.unit}
                </div>
              </div>
              <div>
                <div className="stat-label">Selected values</div>
                <div className="stat-value">
                  {selectionStatsText} {chartMetric.unit}
                </div>
              </div>
            </div>

            <div className="chart-note">
              Drag on the chart (or two-finger drag on mobile) to measure a
              window. Press Enter to zoom into it.
            </div>
            <div>
              <h2>Intervals</h2>
              <p>
                Click an interval to zoom the chart. Shift-click to extend;
                Cmd/Ctrl-click to toggle.
              </p>
            </div>
            <div className="chart-controls">
              {chartIntervalRows.length > 0 && (
                <div
                  className="interval-pills"
                  role="group"
                  aria-label="Intervals"
                >
                  {chartIntervalRows.map((row, idx) => {
                    const selected = selectedIntervalIndices.includes(idx);
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`interval-pill${selected ? " is-selected" : ""}`}
                        aria-pressed={selected}
                        onClick={(event) => {
                          const { nextIndices, nextAnchor } = resolvePillClick(
                            selectedIntervalIndices,
                            lastClickedIntervalIndex,
                            idx,
                            {
                              shiftKey: event.shiftKey,
                              metaOrCtrlKey: event.metaKey || event.ctrlKey,
                            },
                          );
                          setSelectedIntervalIndices(nextIndices);
                          setLastClickedIntervalIndex(nextAnchor);
                        }}
                      >
                        {row.index}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h2>Table</h2>
              </div>
              <div className="chart-controls">
                <button
                  type="button"
                  className="clear-button"
                  onClick={() => setShowTable((prev) => !prev)}
                >
                  {showTable ? "Hide table" : "Show table"}
                </button>
              </div>
            </div>

            {showTable ? (
              <div className="chart-controls">
                <div className="select-wrap">
                  <label htmlFor="interval">Mode</label>
                  <select
                    id="interval"
                    value={intervalOption.label}
                    onChange={(event) =>
                      setIntervalOption(
                        intervalOptions.find(
                          (option) => option.label === event.target.value,
                        ) || intervalOptions[0],
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
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Interval</th>
                        <th>Duration</th>
                        <th>Distance</th>
                        <th>Pace</th>
                        <th>GAP</th>
                        <th>Gain</th>
                        <th>Avg HR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableIntervalRows.map((row) => (
                        <tr key={row.index}>
                          <td>{row.index}</td>
                          <td>{formatDuration(row.duration)}</td>
                          <td>{formatNumber(row.distance / 1000, 2)} km</td>
                          <td>{formatPace(row.pace)}</td>
                          <td>{formatPace(row.gap)}</td>
                          <td>{formatNumber(row.elevationGain, 1)} m</td>
                          <td>{formatNumber(row.avgHr, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        <td>{formatDuration(intervalDuration)}</td>
                        <td>{formatNumber(intervalDistance / 1000, 2)} km</td>
                        <td>{formatPace(totalPace)}</td>
                        <td>{formatPace(totalGap)}</td>
                        <td>
                          {formatNumber(
                            tableIntervalRows.reduce(
                              (acc, row) => acc + row.elevationGain,
                              0,
                            ),
                            1,
                          )}{" "}
                          m
                        </td>
                        <td>{formatNumber(totalHr, 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Upload track</h2>
            <p>Pull a recent run from Google Drive, or drop a GPX/FIT file.</p>
          </div>
        </div>

        <div className="drive-source">
          <div className="drive-header">
            <div>
              <div className="drive-title">Google Drive</div>
              {!drive.configured && (
                <div className="drive-hint">
                  Drive disabled — set VITE_GOOGLE_* in .env.local
                </div>
              )}
            </div>
            {drive.configured && drive.token && (
              <button
                type="button"
                className="clear-button"
                onClick={drive.signOut}
              >
                Sign out
              </button>
            )}
          </div>

          {drive.configured && !drive.token && (
            <button
              type="button"
              className="clear-button drive-signin"
              onClick={drive.signIn}
              disabled={drive.status === "signing-in"}
            >
              {drive.status === "signing-in"
                ? "Signing in…"
                : "Sign in with Google"}
            </button>
          )}

          {drive.configured &&
            drive.token &&
            drive.files.length === 0 &&
            drive.status === "listing" && (
              <div className="drive-hint">Loading files…</div>
            )}

          {drive.configured &&
            drive.token &&
            drive.status === "ready" &&
            drive.files.length === 0 && (
              <div className="drive-hint">No FIT files in this folder yet.</div>
            )}

          {drive.configured && drive.token && drive.files.length > 0 && (
            <>
              <div className="drive-hint">
                {drive.status === "listing"
                  ? `Loading more… (${drive.files.length})`
                  : `${drive.files.length} files`}
              </div>
              <ul className="drive-list">
                {drive.files.map((file) => {
                  const isCurrent = tracks?.fileName === file.name;
                  const isLoading = drive.loadingId === file.id;
                  return (
                    <li
                      key={file.id}
                      className={`drive-row${isCurrent ? " is-current" : ""}`}
                    >
                      <div className="drive-row-meta">
                        <div className="drive-row-name">{file.name}</div>
                        <div className="drive-row-date">
                          {new Date(file.modifiedTime).toLocaleString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="clear-button drive-row-load"
                        onClick={() => drive.loadFile(file)}
                        disabled={isLoading}
                      >
                        {isLoading ? "Loading…" : isCurrent ? "Reload" : "Load"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {drive.error && <div className="error-banner">{drive.error}</div>}
        </div>

        <div className="drive-divider">
          <span>or</span>
        </div>

        <div
          className="dropzone"
          onDragOver={(event: DragEvent<HTMLDivElement>) =>
            event.preventDefault()
          }
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
        >
          <label htmlFor="track-file" className="drop-label">
            {tracks
              ? "Fichier chargé : " + tracks.fileName
              : "Choisissez un GPX/.FIT ou glissez-le ici"}
          </label>
          <input
            id="track-file"
            type="file"
            accept=".gpx,.fit"
            onChange={handleFileChange}
          />
        </div>

        {error && <div className="error-banner">{error}</div>}
      </section>
    </div>
  );
}
