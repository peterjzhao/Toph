"use client";

import { useId, useMemo, useState } from "react";
import s from "./field-timeline.module.css";

export type NdviPoint = { date: string; value: number; validFraction: number };
export type NdviLogMark = { logId: string; date: string; activity: string };

const WIDTH = 640, HEIGHT = 190;
const PAD = { left: 38, right: 14, top: 14, bottom: 30 };
const PLOT = { width: WIDTH - PAD.left - PAD.right, height: HEIGHT - PAD.top - PAD.bottom };
/** NDVI rarely leaves this band on farmland; a floor keeps a flat series from looking dramatic. */
const MIN_DOMAIN_SPAN = 0.25;

const day = (date: string) => Date.parse(`${date}T00:00:00Z`);
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * NDVI over time for one field.
 *
 * Time-proportional on the x-axis rather than evenly spaced, because the gaps are the point: a
 * fortnight with no reading means cloud, and evenly spacing the points would hide that.
 */
export function NdviChart({ series, logs, onSelectLog }: { series: NdviPoint[]; logs: NdviLogMark[]; onSelectLog?: (logId: string) => void }) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const scale = useMemo(() => {
    if (series.length < 2) return null;
    const times = series.map(point => day(point.date));
    const [minTime, maxTime] = [Math.min(...times), Math.max(...times)];
    const values = series.map(point => point.value);
    const low = Math.min(...values), high = Math.max(...values);
    const centre = (low + high) / 2, span = Math.max(MIN_DOMAIN_SPAN, high - low);
    const domain = { min: Math.max(-0.2, centre - span * 0.75), max: Math.min(1, centre + span * 0.75) };
    return {
      x: (date: string) => PAD.left + ((day(date) - minTime) / Math.max(1, maxTime - minTime)) * PLOT.width,
      y: (value: number) => PAD.top + (1 - (value - domain.min) / (domain.max - domain.min)) * PLOT.height,
      domain, minTime, maxTime,
    };
  }, [series]);

  if (!scale) return <p className={s.chartEmpty}>Not enough cloud-free readings to draw a line.</p>;

  const points = series.map(point => ({ ...point, cx: scale.x(point.date), cy: scale.y(point.value) }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.cx.toFixed(1)} ${point.cy.toFixed(1)}`).join(" ");
  const ticks = [scale.domain.min, (scale.domain.min + scale.domain.max) / 2, scale.domain.max];
  const marks = logs.filter(log => day(log.date) >= scale.minTime && day(log.date) <= scale.maxTime);
  const active = hover === null ? null : points[hover];

  return <figure className={s.chart}>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={s.chartSvg} role="img" aria-labelledby={titleId}
      onMouseLeave={() => setHover(null)}
      onMouseMove={event => {
        const box = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - box.left) / box.width) * WIDTH;
        let nearest = 0;
        for (let index = 1; index < points.length; index++) {
          if (Math.abs(points[index].cx - x) < Math.abs(points[nearest].cx - x)) nearest = index;
        }
        setHover(nearest);
      }}>
      <title id={titleId}>NDVI from {shortDate(series[0].date)} to {shortDate(series[series.length - 1].date)}</title>

      {ticks.map(value => <g key={value}>
        <line className={s.grid} x1={PAD.left} x2={WIDTH - PAD.right} y1={scale.y(value)} y2={scale.y(value)} />
        <text className={s.axisLabel} x={PAD.left - 8} y={scale.y(value)} textAnchor="end" dominantBaseline="middle">{value.toFixed(2)}</text>
      </g>)}

      {/* Logged work, marked on the same timeline so the correlation is visible without a model. */}
      {marks.map(mark => <g key={mark.logId} className={s.logMark} onClick={() => onSelectLog?.(mark.logId)} role={onSelectLog ? "button" : undefined} tabIndex={onSelectLog ? 0 : undefined}
        onKeyDown={event => { if (event.key === "Enter") onSelectLog?.(mark.logId); }}>
        <title>{mark.activity} · {shortDate(mark.date)}</title>
        <line x1={scale.x(mark.date)} x2={scale.x(mark.date)} y1={PAD.top} y2={PAD.top + PLOT.height} />
        <circle cx={scale.x(mark.date)} cy={PAD.top} r="4" />
      </g>)}

      <path className={s.line} d={path} fill="none" />
      {points.map(point => <circle key={point.date} className={s.point} cx={point.cx} cy={point.cy} r="4" />)}

      {active && <g className={s.crosshair}>
        <line x1={active.cx} x2={active.cx} y1={PAD.top} y2={PAD.top + PLOT.height} />
        <circle cx={active.cx} cy={active.cy} r="6" />
      </g>}

      <text className={s.axisLabel} x={PAD.left} y={HEIGHT - 8}>{shortDate(series[0].date)}</text>
      <text className={s.axisLabel} x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end">{shortDate(series[series.length - 1].date)}</text>
    </svg>

    {active && <div className={s.tooltip} style={{ left: `${(active.cx / WIDTH) * 100}%` }}>
      <strong>{active.value.toFixed(2)}</strong>
      <span>{shortDate(active.date)}</span>
      <span>{Math.round(active.validFraction * 100)}% of field visible</span>
    </div>}

    <figcaption className={s.chartCaption}>
      Mean NDVI per cloud-free pass. Higher is more vegetation. Blue marks are logged work.
    </figcaption>
  </figure>;
}

/** The same numbers the analysis was given, for anyone who would rather read than look. */
export function NdviTable({ series }: { series: NdviPoint[] }) {
  if (!series.length) return null;
  return <details className={s.readings}>
    <summary>Show the {series.length} readings behind this</summary>
    <table>
      <thead><tr><th scope="col">Date</th><th scope="col">NDVI</th><th scope="col">Field visible</th></tr></thead>
      <tbody>
        {series.map(point => <tr key={point.date}>
          <td>{shortDate(point.date)}</td>
          <td>{point.value.toFixed(3)}</td>
          <td>{Math.round(point.validFraction * 100)}%</td>
        </tr>)}
      </tbody>
    </table>
  </details>;
}
