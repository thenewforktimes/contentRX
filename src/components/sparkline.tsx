/**
 * Tiny inline SVG sparkline — server-rendered, no client JS.
 *
 * Human-eval build plan Session 24. Renders the per-standard weekly
 * kappa series on the /accuracy page. Returns `null` when fewer than
 * two non-null points are available — a single dot isn't a trend.
 *
 * Kept deliberately minimalist (no axes, no legend, no tooltip):
 * rendered next to the kappa number, its job is to answer "is this
 * stable?" at a glance. When the trend matters enough for detail,
 * readers click through to the graduation dashboard.
 */

export interface SparklineProps {
  values: Array<number | null>;
  /** Lower + upper bound of the y-axis. Kappa lives in [-1, 1] but we
   *  usually want to compare above a threshold, so the default is [0, 1]. */
  domain?: [number, number];
  width?: number;
  height?: number;
  /** Optional horizontal reference line — e.g. the threshold for
   *  batch_approval. */
  reference?: number;
  label?: string;
}

export function Sparkline({
  values,
  domain = [0, 1],
  width = 72,
  height = 20,
  reference,
  label,
}: SparklineProps) {
  const points: Array<{ x: number; y: number }> = [];
  const validValues = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => typeof p.v === "number");

  if (validValues.length < 2) return null;

  const [min, max] = domain;
  const span = max - min || 1;
  const last = values.length - 1 || 1;

  for (const { v, i } of validValues) {
    const x = (i / last) * width;
    const y = height - ((v - min) / span) * height;
    points.push({ x, y });
  }

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const refY =
    typeof reference === "number"
      ? height - ((reference - min) / span) * height
      : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? "Weekly kappa trend"}
      className="inline-block align-middle"
    >
      {refY !== null && (
        <line
          x1={0}
          x2={width}
          y1={refY}
          y2={refY}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1]!.x}
          cy={points[points.length - 1]!.y}
          r={1.5}
          fill="currentColor"
        />
      )}
    </svg>
  );
}
