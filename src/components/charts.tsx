import { useId, useMemo, useState } from 'react'
import { money, moneyCompact } from '../lib/util'

/* ============================================================
   Donut — category breakdown. Single accent hue per slice from
   the category, with a muted track behind it.
   ============================================================ */

export function Donut({
  slices,
  total,
  currency,
  decimals = 0,
  size = 168,
  thickness = 20,
  centerLabel,
}: {
  slices: { id: string; label: string; value: number; color: string }[]
  total: number
  currency: string
  decimals?: number
  size?: number
  thickness?: number
  centerLabel?: string
}) {
  const [active, setActive] = useState<string | null>(null)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const gradId = useId()

  const arcs = useMemo(() => {
    let offset = 0
    return slices.map((s) => {
      const frac = total > 0 ? s.value / total : 0
      const len = frac * c
      const arc = { ...s, len, offset, frac }
      offset += len
      return arc
    })
  }, [slices, total, c])

  const focused = active ? slices.find((s) => s.id === active) : null
  const shown = focused
    ? { label: focused.label, value: focused.value, color: focused.color }
    : { label: centerLabel ?? 'Total', value: total, color: 'var(--md-sys-color-on-surface)' }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label="Spending by category">
        <defs>
          <filter id={`${gradId}-soft`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feComposite in="SourceGraphic" in2="b" operator="over" />
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--md-sys-color-outline-variant)"
          strokeWidth={thickness}
        />
        {arcs.map((a, i) => (
          <circle
            key={a.id}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={active === a.id ? thickness + 6 : thickness}
            strokeDasharray={`${Math.max(0, a.len - 2)} ${c - Math.max(0, a.len - 2)}`}
            strokeDashoffset={-a.offset}
            strokeLinecap="butt"
            className="anim-draw transition-[stroke-width] duration-200"
            style={{ ['--dash' as string]: c, animationDelay: `${i * 45}ms`, cursor: 'pointer' }}
            onMouseEnter={() => setActive(a.id)}
            onMouseLeave={() => setActive(null)}
            onClick={() => setActive((v) => (v === a.id ? null : a.id))}
          >
            <title>{`${a.label}: ${money(a.value, currency, decimals)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span
          className="tnum text-xl font-semibold tracking-tight"
          style={{ color: shown.color }}
        >
          {money(shown.value, currency, decimals === 0 ? 0 : 0)}
        </span>
        <span className="mt-0.5 max-w-[80%] truncate text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
          {shown.label}
        </span>
      </div>
    </div>
  )
}

/* ============================================================
   Sparkline / area trend — month-over-month with a soft
   gradient fill. Reads as a shape, not a spreadsheet.
   ============================================================ */

export function AreaTrend({
  data,
  currency,
  height = 116,
  decimals = 0,
}: {
  data: { label: string; value: number }[]
  currency: string
  height?: number
  decimals?: number
}) {
  const gradId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 320
  const H = height
  const pad = 6

  const { path, area, points } = useMemo(() => {
    if (data.length === 0) return { path: '', area: '', points: [] }
    const vals = data.map((d) => d.value)
    const max = Math.max(...vals, 1)
    const min = Math.min(...vals, 0)
    const span = max - min || 1
    const stepX = (W - pad * 2) / Math.max(1, data.length - 1)
    const pts = data.map((d, i) => {
      const x = pad + i * stepX
      const y = pad + (1 - (d.value - min) / span) * (H - pad * 2)
      return { x, y, ...d }
    })
    // Catmull-Rom-ish smoothing via midpoint quadratics.
    let p = `M ${pts[0]!.x} ${pts[0]!.y}`
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const mx = (a.x + b.x) / 2
      p += ` Q ${a.x} ${a.y} ${mx} ${(a.y + b.y) / 2}`
      p += ` Q ${b.x} ${b.y} ${b.x} ${b.y}`
    }
    const last = pts[pts.length - 1]!
    const first = pts[0]!
    return {
      path: p,
      area: `${p} L ${last.x} ${H} L ${first.x} ${H} Z`,
      points: pts,
    }
  }, [data, H])

  if (data.length === 0) return null

  const active = hover !== null ? points[hover] : null

  return (
    <div className="relative w-full" style={{ height: H }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label="Spending trend over recent months"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${gradId}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--md-sys-color-primary)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--md-sys-color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId}-fill)`} />
        <path
          d={path}
          fill="none"
          stroke="var(--md-sys-color-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="anim-draw"
          style={{ ['--dash' as string]: 1200 }}
        />
        {points.map((p, i) => (
          <g key={p.label}>
            <rect
              x={p.x - 16}
              y={0}
              width="32"
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 4.5 : 2.5}
              fill="var(--md-sys-color-surface)"
              stroke="var(--md-sys-color-primary)"
              strokeWidth="2"
              className="transition-all"
            />
          </g>
        ))}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-lg"
          style={{
            left: `${(active.x / W) * 100}%`,
            top: Math.max(0, active.y - 34),
            background: 'var(--md-sys-color-surface-container-low)',
            borderColor: 'var(--md-sys-color-outline-variant)',
            color: 'var(--md-sys-color-on-surface)',
          }}
        >
          <div className="tnum">{money(active.value, currency, decimals)}</div>
          <div className="font-medium text-[var(--md-sys-color-on-surface-variant)]">{active.label}</div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Bar chart — daily/weekly buckets with a highlighted current bar.
   ============================================================ */

export function BarChart({
  data,
  currency,
  height = 132,
  decimals = 0,
  highlightIndex,
}: {
  data: { label: string; value: number }[]
  currency: string
  height?: number
  decimals?: number
  highlightIndex?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.value), 1)
  const active = hover ?? highlightIndex ?? null

  return (
    <div className="w-full">
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 4 : 2, (d.value / max) * (height - 22))
          const on = active === i
          return (
            <div
              key={`${d.label}-${i}`}
              className="group relative flex flex-1 flex-col items-center justify-end"
              style={{ height }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {on && d.value > 0 && (
                <div
                  className="tnum absolute -top-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold shadow-md"
                  style={{
                    background: 'var(--md-sys-color-surface-container-low)',
                    borderColor: 'var(--md-sys-color-outline-variant)',
                    color: 'var(--md-sys-color-on-surface)',
                  }}
                >
                  {money(d.value, currency, decimals === 0 ? 0 : 0)}
                </div>
              )}
              <div
                className="anim-bar w-full rounded-t-[3px] transition-all duration-200"
                style={{
                  height: h,
                  background: on ? 'var(--md-sys-color-primary)' : 'color-mix(in oklab, var(--md-sys-color-primary) 42%, transparent)',
                  animationDelay: `${i * 28}ms`,
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {data.map((d, i) => (
          <div
            key={`lbl-${d.label}-${i}`}
            className="flex-1 text-center text-[9px] font-medium text-[var(--md-sys-color-on-surface-variant)]"
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   Budget ring — progress toward the monthly cap.
   ============================================================ */

export function BudgetRing({
  used,
  projected,
  size = 128,
}: {
  used: number
  projected: number
  currency?: string
  decimals?: number
  size?: number
}) {
  const r = size / 2 - 9
  const c = 2 * Math.PI * r
  // Cap the visual at 100% of the circle but keep the projection readable.
  const frac = Math.min(1, used)
  const projFrac = Math.min(1, projected)
  const over = used > 1

  const state = over ? 'var(--tone-bad)' : projected > 1 ? 'var(--tone-warn)' : 'var(--tone-good)'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--md-sys-color-outline-variant)" strokeWidth="10" />
        {projected > used && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={state}
            strokeWidth="3"
            strokeDasharray={`${projFrac * c} ${c}`}
            strokeLinecap="round"
            opacity="0.45"
            className="anim-draw"
            style={{ ['--dash' as string]: c }}
          />
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={state}
          strokeWidth="10"
          strokeDasharray={`${frac * c} ${c}`}
          strokeLinecap="round"
          className="anim-draw"
          style={{ ['--dash' as string]: c }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-[15px] font-bold" style={{ color: state }}>
          {Math.round(used * 100)}%
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
          used
        </span>
      </div>
    </div>
  )
}

/* ============================================================
   Horizontal category bars for the insight list.
   ============================================================ */

export function CategoryBars({
  slices,
  currency,
  decimals = 0,
  onPick,
}: {
  slices: { category: { id: string; name: string; color: string }; amount: number; share: number; count: number }[]
  total?: number
  currency: string
  decimals?: number
  onPick?: (id: string) => void
}) {
  return (
    <div className="space-y-2.5">
      {slices.map((s, i) => (
        <button
          key={s.category.id}
          onClick={() => onPick?.(s.category.id)}
          className="block w-full text-left"
          disabled={!onPick}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-medium">{s.category.name}</span>
            <span className="tnum shrink-0 text-[13px] font-semibold">
              {money(s.amount, currency, decimals === 0 ? 0 : 0)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--md-sys-color-outline-variant)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, s.share * 100)}%`,
                background: s.category.color,
                transition: 'width .6s var(--md-sys-motion-easing-emphasized)',
                transitionDelay: `${i * 40}ms`,
              }}
            />
          </div>
        </button>
      ))}
    </div>
  )
}

/* ============================================================
   Month-over-month columns.
   ============================================================ */

export function MonthColumns({
  data,
  currency,
}: {
  data: { label: string; value: number }[]
  currency: string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="flex h-28 items-end gap-1.5">
      {data.map((d) => {
        const isLatest = d === data[data.length - 1]
        return (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="tnum w-full rounded-t-md transition-all"
              style={{
                height: Math.max(3, (d.value / max) * 100),
                background: isLatest
                  ? 'var(--md-sys-color-primary)'
                  : 'color-mix(in oklab, var(--md-sys-color-primary) 28%, transparent)',
                transitionDelay: '0ms',
              }}
              title={`${d.label}: ${moneyCompact(d.value, currency)}`}
            />
            <span className="text-[9px] font-medium text-[var(--md-sys-color-on-surface-variant)]">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}
