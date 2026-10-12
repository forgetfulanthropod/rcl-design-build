import { useCallback, useRef } from "react";

/**
 * Circular lunch-duration dial: drag the dot around the ring to pick 0–60 minutes.
 * - Touch/mouse/pen via pointer events (pointer capture keeps the drag on the ring).
 * - Keyboard: Arrow keys ±1 step, PageUp/PageDown ±15, Home/End to 0/60 (role="slider").
 * - Large ±5 buttons for gloved hands. Snaps to `step` (default 5).
 * - Shows the value live in the centre and announces it via aria-valuetext.
 */
export function LunchDial({
  value,
  onChange,
  max = 60,
  step = 5,
  size = 240,
  label = "Lunch duration",
}: {
  value: number;
  onChange: (minutes: number) => void;
  max?: number;
  step?: number;
  size?: number;
  label?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(0, Math.round(n / step) * step)),
    [max, step],
  );
  const r = size / 2 - 22;
  const c = size / 2;
  const frac = value / max;
  const angle = frac * 2 * Math.PI - Math.PI / 2;
  const dot = { x: c + r * Math.cos(angle), y: c + r * Math.sin(angle) };
  const circ = 2 * Math.PI * r;

  function fromPointer(clientX: number, clientY: number) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = clientX - box.left - box.width / 2;
    const y = clientY - box.top - box.height / 2;
    let a = Math.atan2(y, x) + Math.PI / 2; // 0 at top, clockwise
    if (a < 0) a += 2 * Math.PI;
    let next = clamp((a / (2 * Math.PI)) * max);
    // Don't wrap from 60 to 0 (or 0 to 60) when dragging past the top.
    if (value >= max - step && next <= step && a < Math.PI / 2) next = max;
    if (value <= step && next >= max - step && a > (3 * Math.PI) / 2) next = 0;
    if (next !== value) onChange(next);
  }

  const text = `${value} minute${value === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-col items-center gap-3" data-testid="lunch-dial">
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        className="touch-none select-none rounded-full outline-none focus-visible:ring-4 focus-visible:ring-copper/70"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          const map: Record<string, number> = {
            ArrowUp: value + step,
            ArrowRight: value + step,
            ArrowDown: value - step,
            ArrowLeft: value - step,
            PageUp: value + 15,
            PageDown: value - 15,
            Home: 0,
            End: max,
          };
          if (e.key in map) {
            e.preventDefault();
            onChange(clamp(map[e.key]));
          }
        }}
      >
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-line)" strokeWidth={14} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--color-copper)"
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={`${frac * circ} ${circ}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
        {Array.from({ length: max / step + 1 }, (_, i) => i * step)
          .filter((m) => m % 15 === 0 && m < max)
          .map((m) => {
            const a = (m / max) * 2 * Math.PI - Math.PI / 2;
            return (
              <text
                key={m}
                x={c + (r - 30) * Math.cos(a)}
                y={c + (r - 30) * Math.sin(a)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fill="var(--color-muted)"
                aria-hidden="true"
              >
                {m}
              </text>
            );
          })}
        <text x={c} y={c - 6} textAnchor="middle" dominantBaseline="central" fontSize={48} fill="var(--color-fg)" className="font-display tabular-nums" aria-hidden="true">
          {value}
        </text>
        <text x={c} y={c + 30} textAnchor="middle" fontSize={15} fill="var(--color-muted)" aria-hidden="true">
          min lunch
        </text>
        {/* 44px+ hit area around the dot */}
        <circle cx={dot.x} cy={dot.y} r={24} fill="transparent" />
        <circle cx={dot.x} cy={dot.y} r={15} fill="var(--color-fg)" stroke="var(--color-copper)" strokeWidth={4} data-testid="lunch-dot" />
      </svg>
      <div className="grid w-full max-w-xs grid-cols-2 gap-3">
        <button type="button" aria-label="5 minutes less" className="h-14 rounded-md border border-line bg-surface text-2xl text-fg disabled:opacity-40" disabled={value <= 0} onClick={() => onChange(clamp(value - 5))}>
          −5
        </button>
        <button type="button" aria-label="5 minutes more" className="h-14 rounded-md border border-line bg-surface text-2xl text-fg disabled:opacity-40" disabled={value >= max} onClick={() => onChange(clamp(value + 5))}>
          +5
        </button>
      </div>
      <p className="text-base text-fg" aria-live="polite">
        Lunch: {text}
      </p>
    </div>
  );
}
