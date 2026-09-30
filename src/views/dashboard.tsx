import { useMemo, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Flame, Lightbulb,
  PiggyBank, Receipt, Sparkles, Target, TrendingDown, TrendingUp, Wallet, Zap,
} from 'lucide-react'
import { AreaTrend, BudgetRing, CategoryBars, Donut } from '../components/charts'
import type { Insight, Severity } from '../lib/insights'
import { useInsights, useMonth, useRecentTxs, useSettings, useYearSeries } from '../lib/store'
import { monthLabel, money, relativeDay } from '../lib/util'
import type { Tx } from '../lib/types'

const SEV_STYLE: Record<Severity, { color: string; icon: typeof Zap; bg: string }> = {
  bad: { color: 'var(--color-clay)', icon: TrendingUp, bg: 'color-mix(in oklab, var(--color-clay) 12%, transparent)' },
  warn: { color: 'var(--color-amber)', icon: Lightbulb, bg: 'color-mix(in oklab, var(--color-amber) 14%, transparent)' },
  good: { color: 'var(--color-mint)', icon: TrendingDown, bg: 'color-mix(in oklab, var(--color-mint) 13%, transparent)' },
  info: { color: 'var(--color-slate-blue)', icon: Sparkles, bg: 'color-mix(in oklab, var(--color-slate-blue) 12%, transparent)' },
}

export function Dashboard({
  onOpenAdd,
  onOpenTx,
  onOpenInsights,
  onJumpMonth,
}: {
  onOpenAdd: (type: 'expense' | 'income') => void
  onOpenTx: (tx: Tx) => void
  onOpenInsights: () => void
  onJumpMonth: (m: string) => void
}) {
  const { month, isCurrent, goPrev, goNext } = useMonth()
  const a = useInsights(month)
  const series = useYearSeries(month)
  const settings = useSettings()
  const cur = settings.currency
  const dec = settings.decimals
  const [showAllInsights, setShowAllInsights] = useState(false)

  const m = (p: number) => money(p, cur, dec)
  const m0 = (p: number) => money(p, cur, 0)

  const trendData = useMemo(
    () =>
      [...series.entries()].map(([key, v]) => ({ label: monthLabel(`${key}-01`, true).slice(0, 3), value: v.expense })),
    [series],
  )

  const insights = showAllInsights ? a.insights : a.insights.slice(0, 3)
  const prevMonthKey = useMemo(() => {
    const [y, mo] = month.split('-').map(Number)
    const d = new Date(y ?? 1970, (mo ?? 1) - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [month])

  return (
    <div className="space-y-4 pb-2">
      {/* month switcher */}
      <div className="flex items-center justify-between">
        <button onClick={goPrev} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-3)]" aria-label="Previous month">
          <ChevronLeft size={17} />
        </button>
        <div className="text-center">
          <div className="text-[15px] font-bold tracking-tight">{monthLabel(`${month}-01`)}</div>
          {!isCurrent && (
            <button
              onClick={() => onJumpMonth(month)}
              className="text-[11px] font-semibold text-[var(--color-saffron)]"
            >
              viewing history
            </button>
          )}
        </div>
        <button
          onClick={goNext}
          disabled={isCurrent}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-3)] disabled:opacity-30"
          aria-label="Next month"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      {/* hero */}
      <section className="card relative overflow-hidden p-5">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-[0.13] blur-2xl"
          style={{ background: 'var(--color-saffron)' }}
        />
        <div className="relative">
          <div className="label mb-1.5">Spent this month</div>
          <div className="tnum text-[38px] font-bold leading-none tracking-[-0.02em]">{m(a.totals.expense)}</div>

          {a.expenseTrend !== null && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span
                className="chip"
                style={{
                  color: a.expenseTrend > 0 ? 'var(--color-clay)' : 'var(--color-mint)',
                  background:
                    a.expenseTrend > 0
                      ? 'color-mix(in oklab, var(--color-clay) 12%, transparent)'
                      : 'color-mix(in oklab, var(--color-mint) 12%, transparent)',
                  borderColor: 'transparent',
                }}
              >
                {a.expenseTrend > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {Math.abs(Math.round(a.expenseTrend * 100))}%
              </span>
              <span className="text-[12px] text-[var(--fg-muted)]">vs {monthLabel(`${prevMonthKey}-01`, true)}</span>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-mint)]">
                <ArrowDownRight size={12} /> Income
              </div>
              <div className="tnum text-[16px] font-bold">{m0(a.totals.income)}</div>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-clay)]">
                <ArrowUpRight size={12} /> Net saved
              </div>
              <div
                className="tnum text-[16px] font-bold"
                style={{ color: a.totals.net >= 0 ? 'var(--color-mint)' : 'var(--color-clay)' }}
              >
                {m0(a.totals.net)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* budget */}
      {a.budget > 0 && (
        <section className="card flex items-center gap-4 p-4">
          <BudgetRing used={a.budgetUsed} projected={a.budget > 0 ? a.projected / a.budget : 0} currency={cur} />
          <div className="min-w-0 flex-1">
            <div className="label mb-1">Budget</div>
            <div className="tnum text-[15px] font-bold">{m0(a.budget)} / month</div>
            <div className="mt-1.5 text-[12px] leading-snug text-[var(--fg-muted)]">
              {a.budgetLeft >= 0 ? (
                <>
                  <span className="font-semibold" style={{ color: 'var(--color-mint)' }}>
                    {m0(a.budgetLeft)}
                  </span>{' '}
                  left. Projected to finish at{' '}
                  <span className="font-semibold">{m0(a.projected)}</span>.
                </>
              ) : (
                <>
                  Over by <span className="font-semibold">{m0(-a.budgetLeft)}</span>. Projected{' '}
                  {m0(a.projected)}.
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* quick stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <MiniStat
          icon={<Flame size={13} />}
          label="Daily burn"
          value={m0(a.runway.dailyBurn)}
          tone={a.runway.state === 'critical' ? 'bad' : a.runway.state === 'tight' ? 'warn' : 'default'}
        />
        <MiniStat
          icon={<PiggyBank size={13} />}
          label="Saved"
          value={a.savingsRate !== null ? `${Math.round(a.savingsRate * 100)}%` : '—'}
          tone={a.savingsRate === null ? 'default' : a.savingsRate >= 0.2 ? 'good' : a.savingsRate >= 0 ? 'warn' : 'bad'}
        />
        <MiniStat
          icon={<Receipt size={13} />}
          label="Entries"
          value={String(a.dayCount)}
        />
        <MiniStat
          icon={<Target size={13} />}
          label="Runway"
          value={a.runway.days > 0 ? `${a.runway.days}d` : '—'}
          tone={a.runway.state === 'critical' ? 'bad' : a.runway.state === 'tight' ? 'warn' : 'good'}
        />
      </div>

      {/* 12-month trend */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">12-month spending</div>
            <div className="text-[11px] text-[var(--fg-subtle)]">Tap a point for the month total</div>
          </div>
          <span className="tnum chip text-[var(--fg-muted)]">
            avg {m0(trendData.reduce((s, d) => s + d.value, 0) / Math.max(1, trendData.filter((d) => d.value > 0).length))}
          </span>
        </div>
        <AreaTrend data={trendData} currency={cur} />
        <div className="mt-1 flex justify-between text-[9px] font-medium text-[var(--fg-subtle)]">
          <span>{trendData[0]?.label}</span>
          <span>{trendData[trendData.length - 1]?.label}</span>
        </div>
      </section>

      {/* category donut */}
      {a.topCategories.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 text-[13.5px] font-bold">Where it went</div>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <Donut
              slices={a.topCategories.slice(0, 7).map((s) => ({
                id: s.category.id,
                label: s.category.name,
                value: s.amount,
                color: s.category.color,
              }))}
              total={a.totals.expense}
              currency={cur}
            />
            <div className="w-full flex-1">
              <CategoryBars slices={a.topCategories.slice(0, 6)} total={a.totals.expense} currency={cur} />
            </div>
          </div>
        </section>
      )}

      {/* insights */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13.5px] font-bold">Insights</div>
          {a.insights.length > 3 && (
            <button
              onClick={() => setShowAllInsights((v) => !v)}
              className="text-[11.5px] font-bold text-[var(--color-saffron)]"
            >
              {showAllInsights ? 'Show less' : `All ${a.insights.length}`}
            </button>
          )}
        </div>
        <div className="space-y-2">
          {insights.map((ins) => (
            <InsightCard key={ins.id} ins={ins} onOpenInsights={onOpenInsights} />
          ))}
          {insights.length === 0 && (
            <p className="py-6 text-center text-[13px] text-[var(--fg-subtle)]">
              Log a few entries and insights will appear here.
            </p>
          )}
        </div>
      </section>

      {/* add shortcuts */}
      <div className="grid grid-cols-2 gap-2.5">
        <button className="btn py-3" style={{ background: 'var(--color-saffron)', color: '#fff' }} onClick={() => onOpenAdd('expense')}>
          Add expense
        </button>
        <button
          className="btn btn-ghost py-3"
          style={{ color: 'var(--color-mint)' }}
          onClick={() => onOpenAdd('income')}
        >
          Add income
        </button>
      </div>

      {/* recent */}
      <section className="card overflow-hidden p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="text-[13.5px] font-bold">Recent activity</div>
          <button onClick={onOpenInsights} className="text-[11.5px] font-bold text-[var(--color-saffron)]">
            See all
          </button>
        </div>
        <div className="-mx-4">
          <RecentStrip onOpen={onOpenTx} month={month} />
        </div>
      </section>
    </div>
  )
}

function MiniStat({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'good' | 'bad' | 'warn' | 'default'
}) {
  const color =
    tone === 'good'
      ? 'var(--color-mint)'
      : tone === 'bad'
        ? 'var(--color-clay)'
        : tone === 'warn'
          ? 'var(--color-amber)'
          : 'var(--fg)'
  return (
    <div className="card p-3">
      <div className="mb-1 flex items-center gap-1.5" style={{ color: 'var(--fg-subtle)' }}>
        {icon}
        <span className="label">{label}</span>
      </div>
      <div className="tnum text-[15px] font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

export function InsightCard({ ins, onOpenInsights }: { ins: Insight; onOpenInsights: () => void }) {
  const s = SEV_STYLE[ins.severity]
  const Icon = s.icon
  return (
    <button
      onClick={onOpenInsights}
      className="anim-rise w-full rounded-xl p-3 text-left transition-transform active:scale-[0.99]"
      style={{ background: s.bg, borderLeft: `3px solid ${ins.color ?? s.color}` }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'color-mix(in oklab, currentColor 18%, transparent)', color: s.color }}
        >
          <Icon size={13} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-snug">{ins.title}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">{ins.detail}</div>
        </div>
        {ins.value && (
          <span className="tnum shrink-0 text-[13px] font-bold" style={{ color: s.color }}>
            {ins.value}
          </span>
        )}
      </div>
    </button>
  )
}

function RecentStrip({ onOpen, month }: { onOpen: (t: Tx) => void; month: string }) {
  const recent = useRecentTxs(4)
  const settings = useSettings()
  return (
    <div>
      {recent.map((t) => {
        const d = t.date.slice(0, 7)
        return (
          <button
            key={t.id}
            onClick={() => onOpen(t)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-[var(--surface-3)]"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: `color-mix(in oklab, ${t.type === 'income' ? 'var(--color-mint)' : 'var(--color-saffron)'} 15%, transparent)`, color: t.type === 'income' ? 'var(--color-mint)' : 'var(--color-saffron)' }}
            >
              <Wallet size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{t.note || (d === month ? 'Entry' : 'Older')}</div>
              <div className="text-[11px] text-[var(--fg-subtle)]">{relativeDay(t.date)}</div>
            </div>
            <span
              className="tnum text-[13.5px] font-bold"
              style={{ color: t.type === 'income' ? 'var(--color-mint)' : 'var(--fg)' }}
            >
              {t.type === 'income' ? '+' : '−'}
              {money(t.amount, settings.currency, 0)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
