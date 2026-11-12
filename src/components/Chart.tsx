import { useState } from 'react';

export interface Point { x: number; y: number; label: string }

/**
 * Single-series line chart (one measure, one axis). Tap or drag to read a value.
 * Kept dependency-free so it works offline and stays tiny.
 */
export function LineChart(props: { title: string; unit: string; points: Point[]; height?: number }) {
  const { points, unit } = props;
  const [sel, setSel] = useState<number | null>(null);
  const W = 320, H = props.height ?? 150, L = 40, R = 12, T = 12, B = 22;

  if (points.length === 0) {
    return (
      <figure>
        <figcaption className="text-sm font-semibold">{props.title}</figcaption>
        <p className="py-6 text-center text-sm text-mute">No data yet.</p>
      </figure>
    );
  }
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const x0 = points[0].x, x1 = points[points.length - 1].x;
  const px = (x: number) => (x1 === x0 ? (L + W - R) / 2 : L + ((x - x0) / (x1 - x0)) * (W - L - R));
  const py = (y: number) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const fmt = (n: number) => (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n * 10) / 10));
  const cur = sel === null ? points.length - 1 : sel;

  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(px(p.x) - x) < Math.abs(px(points[best].x) - x)) best = i; });
    setSel(best);
  };

  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{props.title}</span>
        <span className="tnum text-sm text-mute">
          {points[cur].label}: <b className="text-ink">{fmt(points[cur].y)} {unit}</b>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full touch-pan-y select-none" role="img"
        aria-label={`${props.title}: ${points.length} data points, latest ${fmt(points[points.length - 1].y)} ${unit}`}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerMove={(e) => { if (e.buttons || e.pointerType !== 'mouse') pick(e.clientX, e.currentTarget); }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="rgb(var(--line))" strokeWidth="1" />
            <text x={L - 6} y={py(t) + 4} textAnchor="end" fontSize="10" fill="rgb(var(--mute))">{fmt(t)}</text>
          </g>
        ))}
        <text x={L} y={H - 5} fontSize="10" fill="rgb(var(--mute))">{points[0].label}</text>
        {points.length > 1 && (
          <text x={W - R} y={H - 5} fontSize="10" textAnchor="end" fill="rgb(var(--mute))">{points[points.length - 1].label}</text>
        )}
        <line x1={px(points[cur].x)} x2={px(points[cur].x)} y1={T} y2={H - B} stroke="rgb(var(--mute))" strokeWidth="1" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.length <= 24 && points.map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={py(p.y)} r="3" fill="rgb(var(--accent))" stroke="rgb(var(--card))" strokeWidth="1.5" />
        ))}
        <circle cx={px(points[cur].x)} cy={py(points[cur].y)} r="5" fill="rgb(var(--accent))" stroke="rgb(var(--card))" strokeWidth="2" />
      </svg>
    </figure>
  );
}
