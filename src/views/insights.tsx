import { useMemo, useState } from 'react'
import {
  AlertTriangle, Brain, CalendarRange, ChevronLeft, ChevronRight, Flame, Info,
  Store, TrendingUp, Zap,
} from 'lucide-react'
import { AreaTrend, BarChart, CategoryBars, MonthColumns } from '../components/charts'
import { StatTile } from '../components/ui'
import { InsightCard } from './dashboard'
import { useInsights, useMonth, useMonthTxs, useSettings, useYearSeries } from '../lib/store'
import { monthLabel, money, monthTrend } from '../lib/util'

export function InsightsView({ onJumpCategory }: { onJumpCategory: (id: string) => void }) {
  const { month, isCurrent, goPrev, goNext } = useMonth()
  const a = useInsights(month)
  const series = useYearSeries(month)
  const settings = useSettings()
  const cur = settings.currency
  const [severity, setSeverity] = useState<'all' | 'action'>('all')

  const monthTxs = useMonthTxs(month)

  const trend = useMemo(
    () =>
      [...series.entries()].map(([k, v]) => ({
        label: monthLabel(`${k}-01`, true).slice(0, 3),
        value: v.expense,
      })),
    [series],
  )

  const incomeTrend = useMemo(
    () =>
      [...series.entries()].map(([k, v]) => ({
        label: monthLabel(`${k}-01`, true).slice(0, 3),
        value: v.income,
      })),
    [series],
  )

  const daily = useMemo(
    () => monthTrend(monthTxs, month, 'expense').map((b) => ({ label: b.label, value: b.amount })),
    [monthTxs, month],
  )

  const shownInsights =
    severity === 'action' ? a.insights.filter((i) => i.severity === 'bad' || i.severity === 'warn') : a.insights

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={goPrev}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-3)]"
          aria-label="Previous month"
        >
          <ChevronLeft size={17} />
        </button>
        <div className="text-center">
          <div className="text-[15px] font-bold tracking-tight">{monthLabel(`${month}-01`)}</div>
          {!isCurrent && <div className="text-[11px] text-[var(--fg-subtle)]">history</div>}
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

      {/* key numbers */}
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile
          icon={<TrendingUp size={13} />}
          label="Total spent"
          value={money(a.totals.expense, cur, 0)}
          tone={a.expenseTrend === null ? 'default' : a.expenseTrend > 0.1 ? 'bad' : a.expenseTrend < -0.05 ? 'good' : 'default'}
          sub={
            a.expenseTrend !== null
              ? `${a.expenseTrend > 0 ? '+' : ''}${Math.round(a.expenseTrend * 100)}% vs last month`
              : 'no prior month'
          }
        />
        <StatTile
          icon={<Flame size={13} />}
          label="Daily average"
          value={money(a.runway.dailyBurn, cur, 0)}
          sub={`${a.dayCount} days with spending`}
        />
        <StatTile
          icon={<CalendarRange size={13} />}
          label="Projected month"
          value={money(a.projected, cur, 0)}
          tone={a.budget > 0 ? (a.projected > a.budget ? 'bad' : 'good') : 'default'}
          sub={a.budget > 0 ? `budget ${money(a.budget, cur, 0)}` : 'set a budget for tracking'}
        />
        <StatTile
          icon={<Store size={13} />}
          label="Top merchant"
          value={a.topMerchant?.name ?? '—'}
          sub={a.topMerchant ? money(a.topMerchant.amount, cur, 0) : 'no notes yet'}
        />
      </div>

      {/* daily rhythm */}
      {a.totals.expense > 0 && (
        <section className="card p-4">
          <div className="mb-1 text-[13.5px] font-bold">Daily rhythm</div>
          <div className="mb-3 text-[11px] text-[var(--fg-subtle)]">
            Spending across the month in six buckets
          </div>
          <BarChart data={daily} currency={cur} />
        </section>
      )}

      {/* category deep dive */}
      {a.topCategories.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[13.5px] font-bold">Category breakdown</div>
            <span className="tnum text-[11px] text-[var(--fg-subtle)]">
              {a.topCategories.reduce((s, x) => s + x.count, 0)} entries
            </span>
          </div>
          <CategoryBars
            slices={a.topCategories}
            total={a.totals.expense}
            currency={cur}
            onPick={onJumpCategory}
          />
        </section>
      )}

      {/* year view */}
      <section className="card p-4">
        <div className="mb-3 text-[13.5px] font-bold">Last 12 months</div>
        <MonthColumns data={trend} currency={cur} />
      </section>

      <section className="card p-4">
        <div className="mb-1 text-[13.5px] font-bold">Spending trajectory</div>
        <div className="mb-3 text-[11px] text-[var(--fg-subtle)]">Smoothed 12-month expense line</div>
        <AreaTrend data={trend} currency={cur} height={130} />
      </section>

      <section className="card p-4">
        <div className="mb-1 text-[13.5px] font-bold">Income trajectory</div>
        <div className="mb-3 text-[11px] text-[var(--fg-subtle)]">Smoothed 12-month income line</div>
        <AreaTrend data={incomeTrend} currency={cur} height={130} />
      </section>

      {/* all insights */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13.5px] font-bold">
            <Brain size={15} style={{ color: 'var(--color-saffron)' }} />
            All insights
          </div>
          <div className="flex gap-1">
            {(['all', 'action'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={`rounded-lg px-2 py-1 text-[10.5px] font-bold transition-colors ${
                  severity === s ? 'bg-[var(--color-saffron)] text-white' : 'bg-[var(--surface-3)] text-[var(--fg-muted)]'
                }`}
              >
                {s === 'all' ? 'All' : 'Needs action'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {shownInsights.map((ins) => (
            <InsightCard key={ins.id} ins={ins} onOpenInsights={() => {}} />
          ))}
          {shownInsights.length === 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <Zap size={22} className="mb-2 text-[var(--color-mint)]" />
              <p className="text-[13px] font-semibold">Nothing needs your attention</p>
              <p className="mt-1 text-[12px] text-[var(--fg-subtle)]">
                No budget breaches or spikes this month.
              </p>
            </div>
          )}
        </div>
      </section>

      {a.anomalies.length > 0 && (
        <section className="card p-4">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13.5px] font-bold">
            <AlertTriangle size={15} style={{ color: 'var(--color-amber)' }} />
            Spikes to review
          </div>
          <div className="space-y-1.5">
            {a.anomalies.slice(0, 5).map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-3)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold">{t.note || 'Entry'}</div>
                  <div className="text-[11px] text-[var(--fg-subtle)]">{t.date}</div>
                </div>
                <span className="tnum text-[13px] font-bold" style={{ color: 'var(--color-amber)' }}>
                  {money(t.amount, cur, 0)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-start gap-2 px-1 pb-2 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>Insights are computed privately on this device from your own entries. Nothing is sent anywhere.</span>
      </div>
    </div>
  )
}
