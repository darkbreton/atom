import { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'recharts';
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

const smoothingOptions = [
  { label: 'Off', value: 0 },
  { label: '10 m', value: 10 },
  { label: '25 m', value: 25 },
  { label: '50 m', value: 50 },
  { label: '100 m', value: 100 },
];

export default function App() {
  const chartRef = useRef(null);
  const [error, setError] = useState('');
  const [tracks, setTracks] = useState(null);
  const [intervalOption, setIntervalOption] = useState(
    intervalOptions.find((option) => option.type === 'auto') || intervalOptions[0],
  );
  const [chartAxisKey, setChartAxisKey] = useState(metricOptions[0].key);
  const [smoothingOption, setSmoothingOption] = useState(smoothingOptions[1]);
  const [zoomWindow, setZoomWindow] = useState([0, 0]);
  const [selectionRange, setSelectionRange] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const [selectedIntervalIndices, setSelectedIntervalIndices] = useState([]);
  const [lastClickedIntervalIndex, setLastClickedIntervalIndex] = useState(null);

  useEffect(() => {
    if (!tracks) return;
    const total = tracks.segments.reduce((sum, segment) => sum + segment.distance, 0);
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

  const handleFile = async (file) => {
    setError('');
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let points;
      let fitLaps = [];

      if (extension === 'fit') {
        const fitData = await parseFit(await file.arrayBuffer());
        points = fitData.points;
        fitLaps = fitData.laps;
      } else {
        points = parseGPX(await file.text());
      }

      const segments = buildSegments(points);
      setTracks({ points, segments, fileName: file.name, fitLaps });
    } catch (err) {
      setTracks(null);
      setError(err.message || 'Erreur de lecture du fichier.');
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (file) await handleFile(file);
  };

  const intervalRows = useMemo(() => {
    if (!tracks) return [];
    if (tracks.fitLaps?.length && intervalOption.type === 'auto') {
      return buildFitIntervals(tracks.points, tracks.segments, tracks.fitLaps);
    }
    return splitIntervals(tracks.segments, intervalOption);
  }, [tracks, intervalOption]);

  const chartData = useMemo(() => {
    if (!tracks) return [];
    return buildChartData(tracks.points, tracks.segments).map((point) => ({
      ...point,
      formattedDistance: formatDistance(point.distance),
    }));
  }, [tracks]);

  const chartDataWithSmoothing = useMemo(() => {
    if (!chartData.length) return [];
    return smoothChartData(chartData, chartAxisKey, smoothingOption.value);
  }, [chartData, chartAxisKey, smoothingOption]);

  const totalDistance = chartDataWithSmoothing.length ? chartDataWithSmoothing[chartDataWithSmoothing.length - 1].distance : 0;

  useEffect(() => {
    if (!selectionRange || !totalDistance) return;
    const step = Math.max(3, (selectionRange.end - selectionRange.start) * 0.05);
    const onKeyDown = (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const span = selectionRange.end - selectionRange.start;
        const nextStart = clamp(selectionRange.start + direction * step, 0, Math.max(0, totalDistance - span));
        setSelectionRange({ start: nextStart, end: nextStart + span });
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        setZoomWindow([selectionRange.start, selectionRange.end]);
        setSelectionRange(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectionRange, totalDistance]);

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
  }, [selectedIntervalIndices, intervalRows, totalDistance]);

  const visibleData = useMemo(() => {
    if (!chartDataWithSmoothing.length) return [];
    return chartDataWithSmoothing.filter((point) => point.distance >= zoomWindow[0] && point.distance <= zoomWindow[1]);
  }, [chartDataWithSmoothing, zoomWindow]);

  const visibleStats = useMemo(() => computeStats(visibleData, 'smoothedValue'), [visibleData]);

  const selectionStats = useMemo(() => {
    if (!selectionRange) return null;
    const selected = chartDataWithSmoothing.filter((point) => point.distance >= selectionRange.start && point.distance <= selectionRange.end);
    return computeStats(selected, 'smoothedValue');
  }, [chartDataWithSmoothing, selectionRange]);

  const handleBrushChange = (brush) => {
    if (!brush || brush.startIndex == null || brush.endIndex == null) return;
    const start = visibleData[brush.startIndex]?.distance ?? zoomWindow[0];
    const end = visibleData[brush.endIndex]?.distance ?? zoomWindow[1];
    setSelectionRange({ start, end });
  };

  const handleChartDoubleClick = (event) => {
    if (!chartRef.current || !totalDistance) return;
    const rect = chartRef.current.getBoundingClientRect();
    const xNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const clicked = zoomWindow[0] + xNorm * (zoomWindow[1] - zoomWindow[0]);

    if (zoomWindow[0] === 0 && zoomWindow[1] === totalDistance) {
      const windowSize = Math.max(100, totalDistance * 0.3);
      const start = clamp(clicked - windowSize / 2, 0, totalDistance - windowSize);
      setZoomWindow([start, Math.min(start + windowSize, totalDistance)]);
      setSelectionRange(null);
    } else {
      setZoomWindow([0, totalDistance]);
      setSelectionRange(null);
    }
  };

  const clearSelection = () => {
    setSelectionRange(null);
  };

  const intervalDistance = intervalRows.reduce((acc, row) => acc + row.distance, 0);
  const intervalDuration = intervalRows.reduce((acc, row) => acc + row.duration, 0);
  const totalPace = intervalDistance > 0 ? intervalDuration / (intervalDistance / 1000) : NaN;
  const totalGap = intervalDistance > 0 ? intervalRows.reduce((acc, row) => acc + row.gap * row.distance, 0) / intervalDistance : NaN;
  const totalHr = intervalRows.reduce((acc, row) => acc + (Number.isFinite(row.avgHr) ? row.avgHr * row.duration : 0), 0) / Math.max(1, intervalRows.reduce((acc, row) => acc + (Number.isFinite(row.avgHr) ? row.duration : 0), 0));

  const chartMetric = metricOptions.find((option) => option.key === chartAxisKey) || metricOptions[0];
  const visibleRangeLabel = `${formatDistance(zoomWindow[0])} → ${formatDistance(zoomWindow[1])}`;
  const selectionLabel = selectionRange ? `${formatDistance(selectionRange.start)} → ${formatDistance(selectionRange.end)}` : null;
  const visibleStatsText = visibleStats ? `${formatMetric(visibleStats.min, chartAxisKey)} / ${formatMetric(visibleStats.avg, chartAxisKey)} / ${formatMetric(visibleStats.max, chartAxisKey)}` : '--';
  const selectionStatsText = selectionStats ? `${formatMetric(selectionStats.min, chartAxisKey)} / ${formatMetric(selectionStats.avg, chartAxisKey)} / ${formatMetric(selectionStats.max, chartAxisKey)}` : '--';

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
                <p>Pick a metric, use the brush to select, then press Enter to zoom.</p>
              </div>
              <div className="chart-controls">
                <div className="select-wrap">
                  <label htmlFor="chart-axis">Y axis</label>
                  <select id="chart-axis" value={chartAxisKey} onChange={(event) => setChartAxisKey(event.target.value)}>
                    {metricOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="select-wrap">
                  <label htmlFor="smoothing">Smoothing</label>
                  <select id="smoothing" value={smoothingOption.label} onChange={(event) => setSmoothingOption(smoothingOptions.find((option) => option.label === event.target.value) || smoothingOptions[0])}>
                    {smoothingOptions.map((option) => (
                      <option key={option.label} value={option.label}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="clear-button" onClick={() => setZoomWindow([0, totalDistance])}>
                  Reset zoom
                </button>
                <button type="button" className="clear-button" onClick={clearSelection}>
                  Clear selection
                </button>
              </div>
            </div>

            <div className="chart-summary">
              <div>Visible {visibleRangeLabel}</div>
              {selectionRange && <div>Selection: {selectionLabel}</div>}
            </div>

            <div className="chart-panel" ref={chartRef} onDoubleClick={handleChartDoubleClick}>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={visibleData} margin={{ top: 12, right: 18, left: 18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="distance" tickFormatter={(value) => `${(value / 1000).toFixed(2)} km`} type="number" domain={["dataMin", "dataMax"]} />
                  <YAxis
                    reversed={chartAxisKey === 'pace' || chartAxisKey === 'gap'}
                    tickFormatter={(value) => (chartAxisKey === 'pace' || chartAxisKey === 'gap' ? formatPace(value) : formatNumber(value, chartAxisKey === 'ele' ? 0 : 0))}
                    domain={['dataMin', 'dataMax']}
                  />
                  <Tooltip
                    wrapperStyle={{ backgroundColor: 'rgba(7, 12, 22, 0.96)', border: '1px solid rgba(255,255,255,0.12)', color: '#e7eef8', borderRadius: '12px', padding: '0.75rem' }}
                    contentStyle={{ backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }}
                    labelStyle={{ color: '#9bb3d8', fontSize: '0.85rem' }}
                    itemStyle={{ color: '#e7eef8', fontSize: '0.95rem' }}
                    labelFormatter={(value) => `${(value / 1000).toFixed(2)} km`}
                    formatter={(value) => (chartAxisKey === 'pace' || chartAxisKey === 'gap' ? formatPace(value) : formatNumber(value, chartAxisKey === 'ele' ? 0 : 0))}
                  />
                  <Line type="monotone" dataKey="smoothedValue" stroke="#7dd3fc" dot={false} strokeWidth={2} isAnimationActive={false} animationDuration={0} />
                  {selectionRange && (
                    <ReferenceArea x1={selectionRange.start} x2={selectionRange.end} stroke="rgba(59, 130, 246, 0.4)" fill="rgba(59, 130, 246, 0.12)" />
                  )}
                  <Brush dataKey="distance" height={26} stroke="#7dd3fc" travellerWidth={10} tickFormatter={(value) => `${(value / 1000).toFixed(2)} km`} onChange={handleBrushChange} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="stats-row">
              <div>
                <div className="stat-label">Visible values</div>
                <div className="stat-value">{visibleStatsText} {chartMetric.unit}</div>
              </div>
              <div>
                <div className="stat-label">Selected values</div>
                <div className="stat-value">{selectionStatsText} {chartMetric.unit}</div>
              </div>
            </div>

            <div className="chart-note">Select with the brush, then press Enter to zoom the selected window.</div>
          </section>

          <section className="card">
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

            {showTable ? (
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
                  {intervalRows.map((row) => (
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
                    <td>{formatNumber(intervalRows.reduce((acc, row) => acc + row.elevationGain, 0), 1)} m</td>
                    <td>{formatNumber(totalHr, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            ) : null}
          </section>
        </>
      ) : null}

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Upload track</h2>
            <p>Drop a GPX or FIT file or tap to select one.</p>
          </div>
        </div>

        <div
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <label htmlFor="track-file" className="drop-label">
            {tracks ? 'Fichier chargé : ' + tracks.fileName : 'Choisissez un GPX/.FIT ou glissez-le ici'}
          </label>
          <input id="track-file" type="file" accept=".gpx,.fit" onChange={handleFileChange} />
        </div>

        {error && <div className="error-banner">{error}</div>}
      </section>
    </div>
  );
}
