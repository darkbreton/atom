import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, TouchEvent } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  metricOptions,
  formatDistance,
  formatMetric,
  formatPace,
  formatNumber,
  buildFitIntervals,
  buildSmoothedChartData,
  computeStats,
  rangeStats,
  clamp,
  resolvePillClick,
  buildStitchedData,
} from "@/lib/trackUtils";
import type {
  IntervalRow,
  MetricKey,
  MetricOption,
  SmoothedChartPoint,
  SmoothedStatPoint,
  Tracks,
} from "@/lib/trackUtils";

// Above this (60:00/km) a pace/gap stat is shown as "n/a" rather than a number.
const PACE_NA_THRESHOLD = 3600;

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

interface ChartCardProps {
  tracks: Tracks;
}

export function ChartCard({ tracks }: ChartCardProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ startX1: number; startX2: number } | null>(
    null,
  );
  const selDragRef = useRef<{
    mode: "move" | "left" | "right";
    startClientX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);

  const [chartAxisKey, setChartAxisKey] = useState<MetricKey>(
    metricOptions[0].key,
  );
  const [chartAxisKey2, setChartAxisKey2] = useState<MetricKey | "off">("ele");
  const [smoothingOption, setSmoothingOption] = useState<SmoothingOption>(
    smoothingOptions[1],
  );
  const [zoomWindow, setZoomWindow] = useState<[number, number]>([0, 0]);
  const [selectionRange, setSelectionRange] = useState<Range | null>(null);
  const [selectedIntervalIndices, setSelectedIntervalIndices] = useState<
    number[]
  >([]);
  const [lastClickedIntervalIndex, setLastClickedIntervalIndex] = useState<
    number | null
  >(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 720px)").matches,
  );

  useEffect(() => {
    if (chartAxisKey2 !== "off" && chartAxisKey2 === chartAxisKey) {
      setChartAxisKey2("off");
    }
  }, [chartAxisKey, chartAxisKey2]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Pixel rect of the chart's plotting area (relative to the chart container),
  // measured from recharts' grid so the draggable selection overlay lines up
  // exactly with the rendered chart regardless of axis width.
  const [plotRect, setPlotRect] = useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);

  const measurePlot = useCallback(() => {
    const container = chartRef.current;
    const grid = container?.querySelector(
      ".recharts-cartesian-grid",
    ) as SVGGElement | null;
    if (!container || !grid) {
      setPlotRect(null);
      return;
    }
    const c = container.getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    setPlotRect({
      left: g.left - c.left,
      width: g.width,
      top: g.top - c.top,
      height: g.height,
    });
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => measurePlot());
    if (chartRef.current) ro.observe(chartRef.current);
    window.addEventListener("resize", measurePlot);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measurePlot);
    };
  }, [measurePlot]);

  useEffect(() => {
    const total = tracks.segments.reduce(
      (sum, segment) => sum + segment.distance,
      0,
    );
    setZoomWindow([0, total]);
    setSelectionRange(null);
    setSelectedIntervalIndices([]);
    setLastClickedIntervalIndex(null);
  }, [tracks]);

  // Interval pills are lap-based only: show one pill per detected lap. Tracks
  // without laps (e.g. plain GPX) get no pills and the section is hidden.
  const chartIntervalRows: IntervalRow[] = useMemo(() => {
    if (tracks.fitLaps.length > 0) {
      return buildFitIntervals(tracks.points, tracks.segments, tracks.fitLaps);
    }
    return [];
  }, [tracks]);

  const chartDataWithSmoothing: SmoothedStatPoint[] = useMemo(
    () =>
      buildSmoothedChartData(
        tracks.points,
        tracks.segments,
        chartAxisKey,
        chartAxisKey2,
        smoothingOption.value,
      ),
    [tracks, chartAxisKey, chartAxisKey2, smoothingOption],
  );

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

  const toStatPoints = (points: SmoothedStatPoint[]) =>
    points.map((p) => ({ distance: p.distance, value: p.rawValue }));

  const visibleStats = useMemo(() => {
    // Stitched mode concatenates non-contiguous segments, so fall back to a
    // simple point mean there; the normal view uses the metric-aware average.
    if (stitchedMode) return computeStats(visibleData, "rawValue");
    return rangeStats(
      toStatPoints(
        chartDataWithSmoothing.filter(
          (point) =>
            point.distance >= zoomWindow[0] && point.distance <= zoomWindow[1],
        ),
      ),
      chartAxisKey,
    );
  }, [
    stitchedMode,
    visibleData,
    chartDataWithSmoothing,
    zoomWindow,
    chartAxisKey,
  ]);

  const selectionStats = useMemo(() => {
    if (!selectionRange) return null;
    return rangeStats(
      toStatPoints(
        chartDataWithSmoothing.filter(
          (point) =>
            point.distance >= selectionRange.start &&
            point.distance <= selectionRange.end,
        ),
      ),
      chartAxisKey,
    );
  }, [chartDataWithSmoothing, selectionRange, chartAxisKey]);

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

  // Re-measure the plot area whenever the chart re-renders (data / zoom /
  // axis changes don't resize the container, so ResizeObserver won't fire).
  useEffect(() => {
    const id = requestAnimationFrame(() => measurePlot());
    return () => cancelAnimationFrame(id);
  }, [
    visibleData,
    zoomWindow,
    isMobile,
    chartAxisKey,
    chartAxisKey2,
    measurePlot,
  ]);

  // Drag the whole selection (move) or its edges (left/right handles).
  const beginSelDrag =
    (mode: "move" | "left" | "right") => (event: ReactPointerEvent) => {
      if (!selectionRange) return;
      event.stopPropagation();
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      selDragRef.current = {
        mode,
        startClientX: event.clientX,
        origStart: selectionRange.start,
        origEnd: selectionRange.end,
      };
    };

  const onSelDragMove = (event: ReactPointerEvent): void => {
    const drag = selDragRef.current;
    if (!drag || !plotRect || plotRect.width <= 0) return;
    const span = zoomWindow[1] - zoomWindow[0];
    if (span <= 0) return;
    const dataDelta =
      ((event.clientX - drag.startClientX) / plotRect.width) * span;
    const minSpan = Math.max(1, span * 0.01);
    if (drag.mode === "move") {
      const width = drag.origEnd - drag.origStart;
      const start = clamp(
        drag.origStart + dataDelta,
        zoomWindow[0],
        zoomWindow[1] - width,
      );
      setSelectionRange({ start, end: start + width });
    } else if (drag.mode === "left") {
      const start = clamp(
        drag.origStart + dataDelta,
        zoomWindow[0],
        drag.origEnd - minSpan,
      );
      setSelectionRange({ start, end: drag.origEnd });
    } else {
      const end = clamp(
        drag.origEnd + dataDelta,
        drag.origStart + minSpan,
        zoomWindow[1],
      );
      setSelectionRange({ start: drag.origStart, end });
    }
  };

  const endSelDrag = (event: ReactPointerEvent): void => {
    if (!selDragRef.current) return;
    const el = event.currentTarget as Element;
    if (el.hasPointerCapture?.(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }
    selDragRef.current = null;
  };

  const chartMetric: MetricOption =
    metricOptions.find((option) => option.key === chartAxisKey) ||
    metricOptions[0];
  const chartConfig: ChartConfig = useMemo(
    () => ({
      smoothedValue: { label: chartMetric.label, color: "var(--chart-1)" },
      smoothedValue2: {
        label: metricOptions.find((o) => o.key === chartAxisKey2)?.label ?? "",
        color: "var(--primary)",
      },
    }),
    [chartMetric.label, chartAxisKey2],
  );
  const visibleRangeLabel = stitchedMode
    ? `stitched: ${selectedIntervalIndices
        .map((i) => chartIntervalRows[i]?.index)
        .filter(Boolean)
        .join(", ")}`
    : `${formatDistance(zoomWindow[0])} → ${formatDistance(zoomWindow[1])}`;
  const selectionLabel = selectionRange
    ? `${+((selectionRange.end - selectionRange.start) / 1000).toFixed(
        2,
      )}km (start at ${formatDistance(selectionRange.start)})`
    : null;
  // Use the selection's stats when it contains values, otherwise the visible
  // range's stats.
  const activeStats = selectionStats ?? visibleStats;
  const activeStatsLabel = selectionStats
    ? "Selected values"
    : "Visible values";
  // Format a stat value; for pace/gap a non-finite or absurdly large value
  // (e.g. from a long stop) is shown as "n/a" rather than a misleading number.
  const formatStat = (value: number): string => {
    if (
      (chartAxisKey === "pace" || chartAxisKey === "gap") &&
      (!Number.isFinite(value) || value >= PACE_NA_THRESHOLD)
    ) {
      return "n/a";
    }
    return formatMetric(value, chartAxisKey);
  };
  const activeStatsText = activeStats
    ? `${formatStat(activeStats.min)} / ${formatStat(
        activeStats.avg,
      )} / ${formatStat(activeStats.max)}`
    : "--";

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Dynamic chart</CardTitle>
        <CardDescription>
          Pick a metric, drag on the chart to select, then press Enter to zoom.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="chart-axis">Y axis</Label>
            <Select
              value={chartAxisKey}
              onValueChange={(value) => setChartAxisKey(value as MetricKey)}
            >
              <SelectTrigger id="chart-axis" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {metricOptions.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="chart-axis-2">Y2 (right)</Label>
            <Select
              value={chartAxisKey2}
              onValueChange={(value) =>
                setChartAxisKey2(value as MetricKey | "off")
              }
            >
              <SelectTrigger id="chart-axis-2" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                {metricOptions
                  .filter((option) => option.key !== chartAxisKey)
                  .map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="smoothing">Smoothing</Label>
            <Select
              value={smoothingOption.label}
              onValueChange={(value) =>
                setSmoothingOption(
                  smoothingOptions.find((option) => option.label === value) ||
                    smoothingOptions[0],
                )
              }
            >
              <SelectTrigger id="smoothing" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {smoothingOptions.map((option) => (
                  <SelectItem key={option.label} value={option.label}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSelectedIntervalIndices([]);
              setLastClickedIntervalIndex(null);
              setZoomWindow([0, totalDistance]);
              setSelectionRange(null);
            }}
          >
            Reset zoom
          </Button>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <div>Visible {visibleRangeLabel}</div>
          {selectionRange && <div>Selection: {selectionLabel}</div>}
        </div>

        <div
          className="relative overflow-hidden rounded-md ring-1 ring-foreground/10 [touch-action:pan-y]"
          ref={chartRef}
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
            if (!touchStartRef.current || event.touches.length !== 2) return;
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
          <ChartContainer
            config={chartConfig}
            className="h-80 w-full select-none"
          >
            <LineChart
              data={visibleData}
              margin={{ top: 12, bottom: 0 }}
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
                if (!isDragging || !event || event.activeLabel == null) return;
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
              <CartesianGrid stroke="var(--border)" vertical={false} />
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
                hide={isMobile}
                reversed={chartAxisKey === "pace" || chartAxisKey === "gap"}
                tickFormatter={(value: number) =>
                  chartAxisKey === "pace" || chartAxisKey === "gap"
                    ? formatPace(value)
                    : formatNumber(value, chartAxisKey === "ele" ? 0 : 0)
                }
                domain={["dataMin", "dataMax"]}
                stroke="var(--color-smoothedValue)"
              />
              {chartAxisKey2 !== "off" && (
                <YAxis
                  yAxisId="right"
                  hide={isMobile}
                  orientation="right"
                  reversed={chartAxisKey2 === "pace" || chartAxisKey2 === "gap"}
                  tickFormatter={(value: number) =>
                    chartAxisKey2 === "pace" || chartAxisKey2 === "gap"
                      ? formatPace(value)
                      : formatNumber(value, chartAxisKey2 === "ele" ? 0 : 0)
                  }
                  domain={["dataMin", "dataMax"]}
                  stroke="var(--color-smoothedValue2)"
                />
              )}
              <ChartTooltip
                cursor={{ stroke: "rgba(255,255,255,0.2)" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={
                      ((
                        _value: unknown,
                        payload: ReadonlyArray<{
                          payload?: {
                            intervalIndex?: number;
                            distance?: number;
                          };
                        }>,
                      ) => {
                        const point = payload?.[0]?.payload;
                        if (!point) return "";
                        if (
                          stitchedMode &&
                          point.intervalIndex != null &&
                          point.distance != null
                        ) {
                          return `int ${point.intervalIndex} · ${(point.distance / 1000).toFixed(2)} km`;
                        }
                        return point.distance != null
                          ? `${(point.distance / 1000).toFixed(2)} km`
                          : "";
                      }) as never
                    }
                    formatter={
                      ((
                        value: unknown,
                        name: unknown,
                        item: { dataKey?: string; color?: string },
                      ) => {
                        const num =
                          typeof value === "number" ? value : Number(value);
                        const key =
                          item?.dataKey === "smoothedValue2" &&
                          chartAxisKey2 !== "off"
                            ? (chartAxisKey2 as MetricKey)
                            : chartAxisKey;
                        const text = !Number.isFinite(num)
                          ? "--"
                          : key === "pace" || key === "gap"
                            ? formatPace(num)
                            : formatNumber(num, 0);
                        return (
                          <>
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-xs"
                              style={{ background: item?.color }}
                            />
                            <div className="flex flex-1 items-center justify-between gap-2 leading-none">
                              <span className="text-muted-foreground">
                                {name as string}
                              </span>
                              <span className="font-mono font-medium tabular-nums text-foreground">
                                {text}
                              </span>
                            </div>
                          </>
                        );
                      }) as never
                    }
                  />
                }
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="smoothedValue"
                name={chartMetric.label}
                stroke="var(--color-smoothedValue)"
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                animationDuration={0}
              />
              {chartAxisKey2 !== "off" && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="smoothedValue2"
                  name={
                    metricOptions.find((o) => o.key === chartAxisKey2)?.label ??
                    ""
                  }
                  stroke="var(--color-smoothedValue2)"
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
                  yAxisId="left"
                  x1={selectionRange.start}
                  x2={selectionRange.end}
                  stroke="var(--primary)"
                  strokeWidth={1}
                  fill="oklch(from var(--primary) l c h / .2)"
                />
              )}
            </LineChart>
          </ChartContainer>

          {!isMobile &&
            !isDragging &&
            !stitchedMode &&
            selectionRange &&
            plotRect &&
            zoomWindow[1] > zoomWindow[0] &&
            (() => {
              const span = zoomWindow[1] - zoomWindow[0];
              const fStart = clamp(
                (selectionRange.start - zoomWindow[0]) / span,
                0,
                1,
              );
              const fEnd = clamp(
                (selectionRange.end - zoomWindow[0]) / span,
                0,
                1,
              );
              return (
                <div
                  className="absolute z-10 cursor-grab transition-colors hover:bg-primary/10 active:cursor-grabbing"
                  style={{
                    left: plotRect.left + fStart * plotRect.width,
                    width: Math.max(0, (fEnd - fStart) * plotRect.width),
                    top: plotRect.top,
                    height: plotRect.height,
                  }}
                  role="slider"
                  aria-label="Selection — drag to move, drag edges to resize"
                  onPointerDown={beginSelDrag("move")}
                  onPointerMove={onSelDragMove}
                  onPointerUp={endSelDrag}
                  onPointerCancel={endSelDrag}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <div
                    className="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize touch-none"
                    onPointerDown={beginSelDrag("left")}
                    onPointerMove={onSelDragMove}
                    onPointerUp={endSelDrag}
                    onPointerCancel={endSelDrag}
                  >
                    <div className="absolute inset-y-[40%] left-1/2 w-1 -translate-x-1/2 rounded-full bg-primary shadow" />
                  </div>
                  <div
                    className="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize touch-none"
                    onPointerDown={beginSelDrag("right")}
                    onPointerMove={onSelDragMove}
                    onPointerUp={endSelDrag}
                    onPointerCancel={endSelDrag}
                  >
                    <div className="absolute inset-y-[40%] left-1/2 w-1 -translate-x-1/2 rounded-full bg-primary shadow" />
                  </div>
                </div>
              );
            })()}
        </div>

        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            {activeStatsLabel}
          </div>
          <div className="text-base font-semibold tabular-nums">
            {activeStatsText} {chartMetric.unit}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {isMobile
            ? "Drag on the chart (or two-finger drag on mobile) to measure a window."
            : "Press Enter to zoom into it."}
        </p>

        {chartIntervalRows.length > 0 && (
          <>
            <div>
              <h2 className="text-base font-semibold">Laps</h2>
              <p className="text-sm text-muted-foreground">
                Click a lap to zoom the chart.
                {!isMobile && (
                  <>Shift-click to extend; Cmd/Ctrl-click to toggle.</>
                )}
              </p>
            </div>
            <div
              className="flex flex-wrap gap-2 overflow-x-auto"
              role="group"
              aria-label="Laps"
            >
              {chartIntervalRows.map((row, idx) => {
                const selected = selectedIntervalIndices.includes(idx);
                return (
                  <Button
                    key={idx}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    size="sm"
                    className="min-w-10 tabular-nums"
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
                  </Button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
