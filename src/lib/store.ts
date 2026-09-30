import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db, DEFAULT_SETTINGS } from './db'
import type { Category, Settings, Tx, TxType } from './types'
import { addMonths, startOfMonth, today, uid } from './util'

/* ---------------- settings ---------------- */

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('app'), [], undefined)
  return s ?? DEFAULT_SETTINGS
}

export function useTheme() {
  const settings = useSettings()
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    const apply = () => {
      const pref = settings.theme
      const mode =
        pref === 'system'
          ? matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : pref
      document.documentElement.classList.toggle('dark', mode === 'dark')
      document.documentElement.style.colorScheme = mode
      setResolved(mode)
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  // Mirror to localStorage so the pre-paint inline script in index.html agrees.
  useEffect(() => {
    try {
      localStorage.setItem('khata.theme', settings.theme)
    } catch {
      /* ignore */
    }
  }, [settings.theme])

  return { mode: resolved, pref: settings.theme }
}

/* ---------------- categories ---------------- */

export function useCategories() {
  const rows = useLiveQuery(() => db.categories.orderBy('sort').toArray(), [], [])
  const map = useMemo(() => new Map((rows ?? []).map((c) => [c.id, c])), [rows])
  return { categories: rows ?? [], map }
}

/* ---------------- transactions ---------------- */

export function useMonthTxs(monthIso: string): Tx[] {
  return (
    useLiveQuery(
      async () => {
        const from = `${monthIso}-01`
        const to = `${monthIso}-31`
        return db.tx
          .where('date')
          .between(from, to, true, true)
          .sortBy('date')
      },
      [monthIso],
      [],
    ) ?? []
  )
}

/** 12-month series for the trend chart. */
export function useYearSeries(currentMonth: string) {
  return useLiveQuery(async () => {
    const first = `${addMonths(currentMonth, -11)}-01`
    const last = `${currentMonth}-31`
    const rows = await db.tx.where('date').between(first, last, true, true).toArray()
    const map = new Map<string, { income: number; expense: number }>()
    for (let i = 0; i < 12; i++) {
      map.set(addMonths(currentMonth, -11 + i).slice(0, 7), { income: 0, expense: 0 })
    }
    for (const t of rows) {
      const key = t.date.slice(0, 7)
      const slot = map.get(key)
      if (!slot) continue
      if (t.type === 'income') slot.income += t.amount
      else slot.expense += t.amount
    }
    return map
  }, [currentMonth], new Map())
}

export function useRecentTxs(limit = 200) {
  return useLiveQuery(() => db.tx.orderBy('date').reverse().limit(limit).toArray(), [limit], []) ?? []
}

export function useAllTxs() {
  return useLiveQuery(() => db.tx.toArray(), [], []) ?? []
}

export function useTxCount(): number {
  return useLiveQuery(() => db.tx.count(), [], 0) ?? 0
}

/* ---------------- mutations ---------------- */

export async function addTx(
  input: Omit<Tx, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<Tx> {
  const now = Date.now()
  const tx: Tx = {
    id: input.id ?? uid('t'),
    type: input.type,
    amount: input.amount,
    categoryId: input.categoryId,
    note: input.note,
    date: input.date,
    status: input.status,
    recurring: input.recurring,
    createdAt: now,
    updatedAt: now,
  }
  await db.tx.put(tx)
  return tx
}

export async function updateTx(id: string, patch: Partial<Tx>): Promise<void> {
  await db.tx.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteTx(id: string): Promise<void> {
  await db.tx.delete(id)
}

export async function restoreTx(tx: Tx): Promise<void> {
  await db.tx.put(tx)
}

export async function saveCategory(input: Partial<Category> & { id?: string }): Promise<string> {
  const id = input.id ?? uid('c')
  const existing = await db.categories.get(id)
  const row: Category = {
    id,
    name: input.name ?? existing?.name ?? 'New category',
    icon: input.icon ?? existing?.icon ?? 'Tag',
    color: input.color ?? existing?.color ?? '#8A8078',
    kind: input.kind ?? existing?.kind ?? 'expense',
    monthlyLimit: input.monthlyLimit ?? existing?.monthlyLimit ?? 0,
    archived: input.archived ?? existing?.archived ?? false,
    sort: input.sort ?? existing?.sort ?? 50,
  }
  await db.categories.put(row)
  return id
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const cur = (await db.settings.get('app')) ?? DEFAULT_SETTINGS
  await db.settings.put({ ...cur, ...patch, id: 'app' })
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tx, db.categories, db.settings, async () => {
    await db.tx.clear()
    await db.categories.clear()
    await db.settings.put(DEFAULT_SETTINGS)
  })
}

/* ---------------- insights ---------------- */

import { analyse } from './insights'

export function useInsights(monthIso: string) {
  const monthTxs = useMonthTxs(monthIso)
  const prevMonth = addMonths(monthIso, -1).slice(0, 7)
  const prevTxs = useMonthTxs(prevMonth)
  const { map } = useCategories()
  const settings = useSettings()

  return useMemo(
    () =>
      analyse({
        monthTxs,
        prevMonthTxs: prevTxs,
        cats: map,
        settings: {
          currency: settings.currency,
          decimals: settings.decimals,
          overallMonthlyLimit: settings.overallMonthlyLimit,
        },
      }),
    [monthTxs, prevTxs, map, settings.currency, settings.decimals, settings.overallMonthlyLimit],
  )
}

/* ---------------- import / export ---------------- */

export interface CsvRow {
  date: string
  type: TxType
  category: string
  note: string
  amount: number
  recurring: boolean
}

export function toCsv(rows: CsvRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const head = 'date,type,category,note,amount,recurring'
  const body = rows
    .map((r) =>
      [r.date, r.type, esc(r.category), esc(r.note), (r.amount / 100).toFixed(2), r.recurring ? 'yes' : 'no'].join(','),
    )
    .join('\n')
  return `${head}\n${body}`
}

export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const head = (lines[0] ?? '').toLowerCase()
  const hasHeader = head.includes('date') && head.includes('amount')
  const rows: CsvRow[] = []
  const cells = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (ch === '"') inQ = false
        else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === ',') {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    return out
  }
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = cells(lines[i] ?? '')
    if (c.length < 2) continue
    const rawDate = (c[0] ?? '').trim()
    // Accept yyyy-mm-dd, dd/mm/yyyy and dd-mm-yyyy.
    let date = rawDate
    const m1 = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
    const m2 = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
    if (m1) date = `${m1[1]}-${m1[2]}-${m1[3]}`
    else if (m2) date = `${m2[3]}-${String(m2[2]).padStart(2, '0')}-${String(m2[1]).padStart(2, '0')}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const typeRaw = (c[1] ?? '').toLowerCase()
    const type: TxType = typeRaw.startsWith('inc') || typeRaw === '+' || typeRaw === 'credit' ? 'income' : 'expense'
    const amount = Number((c[c.length - 1] ?? '').replace(/[^0-9.\-]/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) continue
    rows.push({
      date,
      type,
      category: (c[2] ?? '').trim() || 'Other',
      note: (c[3] ?? '').trim(),
      amount: Math.round(amount * 100),
      recurring: (c[4] ?? '').toLowerCase().startsWith('y'),
    })
  }
  return rows
}

export async function importCsv(text: string, cats: Category[]): Promise<number> {
  const rows = parseCsv(text)
  if (rows.length === 0) return 0
  const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c]))
  const fallback = new Map<TxType, Category>(
    cats.reduce<[TxType, Category][]>((acc, c) => {
      acc.push([c.kind, c])
      return acc
    }, []),
  )
  const now = Date.now()
  const out: Tx[] = rows.map((r, i) => {
    const kind: TxType = r.type
    let cat = byName.get(r.category.toLowerCase())
    if (cat && cat.kind !== kind) cat = undefined
    if (!cat) {
      cat =
        [...byName.values()].find((c) => c.name.toLowerCase() === r.category.toLowerCase() && c.kind === kind) ??
        cats.find((c) => c.name.toLowerCase() === 'other' && c.kind === kind) ??
        fallback.get(kind)
    }
    return {
      id: uid('t'),
      type: r.type,
      amount: r.amount,
      categoryId: cat?.id ?? 'c_other',
      note: r.note,
      date: r.date,
      status: 'cleared',
      recurring: r.recurring,
      createdAt: now + i,
      updatedAt: now + i,
    }
  })
  await db.tx.bulkPut(out)
  return out.length
}

export function useMonth() {
  const [month, setMonth] = useState(() => startOfMonth(today()).slice(0, 7))
  return {
    month,
    setMonth,
    isCurrent: month === startOfMonth(today()).slice(0, 7),
    goPrev: () => setMonth((m) => addMonths(m, -1).slice(0, 7)),
    goNext: () => setMonth((m) => addMonths(m, 1).slice(0, 7)),
  }
}
