import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Filter, Search, X } from 'lucide-react'
import { CategoryIcon } from '../components/tx-editor'
import { EmptyState, SegmentedControl } from '../components/ui'
import type { Category, Tx, TxType } from '../lib/types'
import { useAllTxs, useCategories, useMonth, useSettings } from '../lib/store'
import { money, monthLabel, relativeDay } from '../lib/util'

type Sort = 'recent' | 'largest'

export function Transactions({
  onOpen,
  filterCategory,
  onClearCategory,
}: {
  onOpen: (t: Tx) => void
  filterCategory: string | null
  onClearCategory: () => void
}) {
  const { month, isCurrent, goPrev, goNext } = useMonth()
  const all = useAllTxs()
  const { map } = useCategories()
  const settings = useSettings()
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | TxType>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [searching, setSearching] = useState(false)

  const rows = useMemo(() => {
    let out = all
    if (!filterCategory) out = out.filter((t) => t.date.slice(0, 7) === month)
    if (type !== 'all') out = out.filter((t) => t.type === type)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      out = out.filter(
        (t) =>
          t.note.toLowerCase().includes(needle) ||
          (map.get(t.categoryId)?.name.toLowerCase().includes(needle) ?? false) ||
          money(t.amount, settings.currency, 0).includes(needle),
      )
    }
    return [...out].sort((a, b) =>
      sort === 'largest' ? b.amount - a.amount : b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
    )
  }, [all, month, type, q, sort, filterCategory, map, settings.currency])

  const groups = useMemo(() => {
    const g = new Map<string, Tx[]>()
    for (const t of rows) {
      const key = t.date
      const arr = g.get(key) ?? []
      arr.push(t)
      g.set(key, arr)
    }
    return [...g.entries()]
  }, [rows])

  const dayTotal = (list: Tx[]) =>
    list.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0)

  const filteredCat = filterCategory ? map.get(filterCategory) : null

  return (
    <div className="space-y-3">
      {/* search + filter bar */}
      <div className="flex items-center gap-2">
        {searching ? (
          <div className="anim-fade flex flex-1 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2">
            <Search size={15} className="shrink-0 text-[var(--fg-subtle)]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search notes, categories, amounts"
              className="w-full bg-transparent text-[13px] outline-none"
            />
            <button
              onClick={() => {
                setQ('')
                setSearching(false)
              }}
              aria-label="Close search"
            >
              <X size={15} className="text-[var(--fg-subtle)]" />
            </button>
          </div>
        ) : (
          <>
            {!filterCategory && (
              <div className="flex flex-1 items-center gap-1.5">
                <button onClick={goPrev} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-3)]" aria-label="Previous month">
                  ‹
                </button>
                <div className="flex-1 text-center text-[13px] font-bold">{monthLabel(`${month}-01`, true)}</div>
                <button
                  onClick={goNext}
                  disabled={isCurrent}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-3)] disabled:opacity-30"
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
            )}
            {filteredCat && (
              <div className="flex flex-1 items-center gap-2">
                <span
                  className="chip"
                  style={{
                    color: filteredCat.color,
                    background: `color-mix(in oklab, ${filteredCat.color} 14%, transparent)`,
                    borderColor: 'transparent',
                  }}
                >
                  <CategoryIcon name={filteredCat.icon} className="h-3 w-3" />
                  {filteredCat.name}
                </span>
                <button onClick={onClearCategory} className="ml-auto text-[11.5px] font-bold text-[var(--color-saffron)]">
                  Clear
                </button>
              </div>
            )}
            <button
              onClick={() => setSearching(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)]"
              aria-label="Search"
            >
              <Search size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <SegmentedControl
          value={type}
          onChange={setType}
          size="sm"
          options={[
            { value: 'all', label: 'All' },
            { value: 'expense', label: 'Spent' },
            { value: 'income', label: 'Earned' },
          ]}
        />
        <button
          onClick={() => setSort((s) => (s === 'recent' ? 'largest' : 'recent'))}
          className="chip ml-auto text-[11px] text-[var(--fg-muted)]"
        >
          <Filter size={11} />
          {sort === 'recent' ? 'Recent' : 'Largest'}
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={24} />}
          title={q ? 'No matches' : filterCategory ? `Nothing in ${filteredCat?.name}` : 'No entries'}
          body={
            q
              ? 'Try a different search term.'
              : filterCategory
                ? 'This category has no transactions in the selected month.'
                : 'Add your first entry with the + button below.'
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map(([date, list]) => (
            <div key={date}>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <span className="label">{relativeDay(date)}</span>
                <span
                  className="tnum text-[11px] font-bold"
                  style={{
                    color:
                      dayTotal(list) >= 0 ? 'var(--color-mint)' : 'var(--fg-subtle)',
                  }}
                >
                  {dayTotal(list) >= 0 ? '+' : '−'}
                  {money(Math.abs(dayTotal(list)), settings.currency, 0)}
                </span>
              </div>
              <div className="card overflow-hidden">
                {list.map((t, i) => (
                  <TxRow key={t.id} tx={t} cat={map.get(t.categoryId)} currency={settings.currency} onClick={() => onOpen(t)} last={i === list.length - 1} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TxRow({
  tx,
  cat,
  currency,
  onClick,
  last,
}: {
  tx: Tx
  cat?: Category
  currency: string
  onClick: () => void
  last: boolean
}) {
  const isIncome = tx.type === 'income'
  const color = cat?.color ?? 'var(--fg-subtle)'
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-[var(--surface-3)] ${
        last ? '' : 'border-b border-[var(--line)]'
      }`}
      style={{ opacity: tx.status === 'pending' ? 0.6 : 1 }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
      >
        <CategoryIcon name={cat?.icon ?? 'Tag'} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold">{tx.note || cat?.name || 'Entry'}</span>
          {tx.recurring && (
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-[var(--color-amber)]">bill</span>
          )}
        </div>
        <div className="truncate text-[11.5px] text-[var(--fg-subtle)]">{cat?.name ?? 'Uncategorised'}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span
          className="tnum text-[14px] font-bold"
          style={{ color: isIncome ? 'var(--color-mint)' : 'var(--fg)' }}
        >
          {isIncome ? '+' : '−'}
          {money(tx.amount, currency, 0)}
        </span>
        {isIncome ? (
          <ArrowDownLeft size={13} style={{ color: 'var(--color-mint)' }} />
        ) : (
          <ArrowUpRight size={13} className="text-[var(--fg-subtle)]" />
        )}
      </div>
    </button>
  )
}
