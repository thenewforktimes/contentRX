"use client";

/**
 * Hand-rolled SVG calibration chart (audit Pf7).
 *
 * Phase B5b of the post-pivot rolling plan. Replaces the text
 * sparklines on `/admin/calibration` with a single aggregate line
 * chart showing system κ over the last N weeks.
 *
 * Pre-Pf7 this file imported `recharts` (~115kB minified). The chart
 * displays at most 12 weekly points with two reference lines — a
 * fraction of recharts' feature surface. Hand-rolling the SVG drops
 * the entire dependency from /admin/calibration's bundle and keeps
 * the visual identical.
 *
 * Data shape: an array of `{ week_offset, kappa, sample_size }`
 * pairs, oldest first. `week_offset` is 0 for the most recent week,
 * negative for older weeks (so the X axis reads as "weeks ago"
 * left to right). Pending weeks are omitted upstream.
 */

import { useId, useState } from "react";

export interface SystemKappaPoint {
  week_offset: number;
  kappa: number;
  sample_size: number;
}

export interface SystemKappaTrendChartProps {
  points: SystemKappaPoint[];
  designTarget: number;
  autonomousThreshold: number;
}

// Plot geometry. The SVG scales responsively via viewBox; pixel-equivalent
// values here are coordinates inside that viewBox, not screen pixels.
const VIEW_W = 600;
const VIEW_H = 256;
const PAD = { top: 16, right: 80, bottom: 28, left: 44 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;
const Y_MIN = 0.5;
const Y_MAX = 1.0;
const Y_TICKS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

export function SystemKappaTrendChart({
  points,
  designTarget,
  autonomousThreshold,
}: SystemKappaTrendChartProps) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-white p-6 text-center text-sm text-quiet dark:bg-stone-900">
        No weekly κ measurements available yet. The chart populates as
        per-standard κ accumulates across multiple weeks.
      </div>
    );
  }

  const xMin = Math.min(...points.map((p) => p.week_offset));
  const xMax = Math.max(...points.map((p) => p.week_offset));
  // Avoid divide-by-zero when there's a single point — nudge the
  // domain to a 1-week width so the dot lands centered.
  const xRange = xMax === xMin ? 1 : xMax - xMin;

  const xFor = (weekOffset: number): number =>
    PAD.left + ((weekOffset - xMin) / xRange) * PLOT_W;
  const yFor = (kappa: number): number =>
    PAD.top + ((Y_MAX - kappa) / (Y_MAX - Y_MIN)) * PLOT_H;

  const polyline = points
    .map((p) => `${xFor(p.week_offset)},${yFor(p.kappa)}`)
    .join(" ");

  const designTargetY = yFor(designTarget);
  const autonomousY = yFor(autonomousThreshold);

  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-stone-900">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-64 w-full"
        role="img"
        aria-describedby={tooltipId}
      >
        <title>System Cohen&apos;s κ over time</title>

        {/* Y-axis grid lines + tick labels */}
        {Y_TICKS.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-quiet"
                strokeDasharray="3 3"
              />
              <text
                x={PAD.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-stone-500 text-[11px]"
              >
                {tick.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* X-axis tick labels */}
        {points.map((p) => {
          const x = xFor(p.week_offset);
          const label = p.week_offset === 0 ? "now" : `${p.week_offset}w`;
          return (
            <text
              key={`xtick-${p.week_offset}`}
              x={x}
              y={VIEW_H - PAD.bottom + 16}
              textAnchor="middle"
              className="fill-stone-500 text-[11px]"
            >
              {label}
            </text>
          );
        })}

        {/* Reference lines: design target + autonomous threshold. Drawn
            BEFORE the data line so the data sits on top. */}
        <ReferenceLine
          y={designTargetY}
          xEnd={PAD.left + PLOT_W}
          label="design target"
          stroke="currentColor"
          className="text-stone-400"
          dash="4 4"
        />
        <ReferenceLine
          y={autonomousY}
          xEnd={PAD.left + PLOT_W}
          label="autonomous κ"
          stroke="rgb(16, 185, 129)"
          className="text-emerald-500/70"
          dash="2 6"
        />

        {/* The line itself + dots */}
        <polyline
          points={polyline}
          fill="none"
          stroke="currentColor"
          className="text-strong"
          strokeWidth={2}
        />
        {points.map((p, i) => {
          const cx = xFor(p.week_offset);
          const cy = yFor(p.kappa);
          const isHovered = hovered === i;
          return (
            <g key={`dot-${p.week_offset}`}>
              {/* Larger invisible hit target for hover/touch. Keeps the
                  visible dot small while making the chart usable. */}
              <circle
                cx={cx}
                cy={cy}
                r={12}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                tabIndex={0}
                aria-label={`Week ${p.week_offset}: κ ${p.kappa.toFixed(2)}, sample ${p.sample_size}`}
              />
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? 5 : 3}
                fill="currentColor"
                className="text-strong"
              />
            </g>
          );
        })}

        {/* Tooltip — anchored above the hovered point. Rendered last
            so it floats above the rest. */}
        {hovered !== null && (
          <Tooltip
            point={points[hovered]}
            x={xFor(points[hovered].week_offset)}
            y={yFor(points[hovered].kappa)}
          />
        )}
      </svg>
      <p id={tooltipId} className="sr-only">
        System Cohen&apos;s κ across weekly samples. Hover or focus a
        point to read its value and sample size.
      </p>
    </div>
  );
}

function ReferenceLine({
  y,
  xEnd,
  label,
  stroke,
  className,
  dash,
}: {
  y: number;
  xEnd: number;
  label: string;
  stroke: string;
  className: string;
  dash: string;
}) {
  return (
    <g>
      <line
        x1={PAD.left}
        x2={xEnd}
        y1={y}
        y2={y}
        stroke={stroke}
        className={className}
        strokeDasharray={dash}
      />
      <text
        x={xEnd + 4}
        y={y}
        dominantBaseline="middle"
        className={`text-[10px] ${className}`}
        fill="currentColor"
      >
        {label}
      </text>
    </g>
  );
}

function Tooltip({
  point,
  x,
  y,
}: {
  point: SystemKappaPoint;
  x: number;
  y: number;
}) {
  const PADDING = 6;
  const W = 116;
  const H = 38;
  // Default: tooltip floats above the dot. Flip below when too close
  // to the top so it doesn't clip out of the SVG.
  const above = y > PAD.top + H + PADDING;
  const ty = above ? y - H - PADDING - 4 : y + PADDING + 4;
  // Clamp horizontally so the tooltip stays inside the plot area.
  const tx = Math.max(
    PAD.left,
    Math.min(VIEW_W - PAD.right - W, x - W / 2),
  );
  const label =
    point.week_offset === 0 ? "now" : `${Math.abs(point.week_offset)}w ago`;
  return (
    <g pointerEvents="none">
      <rect
        x={tx}
        y={ty}
        width={W}
        height={H}
        rx={4}
        fill="white"
        stroke="rgba(0,0,0,0.1)"
        className="dark:fill-stone-800"
      />
      <text
        x={tx + 8}
        y={ty + 14}
        className="fill-stone-900 text-[11px] font-medium dark:fill-stone-100"
      >
        {label} · κ {point.kappa.toFixed(2)}
      </text>
      <text
        x={tx + 8}
        y={ty + 28}
        className="fill-stone-500 text-[10px]"
      >
        n = {point.sample_size}
      </text>
    </g>
  );
}
