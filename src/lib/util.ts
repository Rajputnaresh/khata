import type { Category, Settings, Tx } from './types'

/* ---------- ids ---------- */

export function uid(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  let out = ''
  for (const b of bytes) out += b.toString(36).padStart(2, '0')
  return prefix ? `${prefix}_${out}` : out
}

/* ---------- dates (local calendar, never UTC-shifted) ---------- */

export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function today(): string {
  return toISODate()
}

/** Parse a yyyy-mm-dd string into a local Date (avoids the UTC midnight shift). */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function addMonths(iso: string, delta: number): string {
  const d = fromISODate(startOfMonth(iso))
  d.setMonth(d.getMonth() + delta)
  return toISODate(d)
}

export function addDays(iso: string, delta: number): string {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + delta)
  return toISODate(d)
}

export function daysInMonth(iso: string): number {
  const d = fromISODate(startOfMonth(iso))
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

export function monthLabel(iso: string, short = false): string {
  const [y, m] = iso.split('-').map(Number)
  const name = MONTHS[(m ?? 1) - 1] ?? ''
  return short ? `${name.slice(0, 3)} ${y}` : `${name} ${y}`
}

export function dayLabel(iso: string): string {
  const d = fromISODate(iso)
  return `${DOW[d.getDay()]?.slice(0, 3) ?? ''}, ${d.getDate()} ${MONTHS[d.getMonth()]?.slice(0, 3) ?? ''}`
}

/** "Today" / "Yesterday" / "12 Aug 2026" */
export function relativeDay(iso: string): string {
  const t = today()
  if (iso === t) return 'Today'
  if (iso === addDays(t, -1)) return 'Yesterday'
  const d = fromISODate(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${sameYear ? '' : d.getFullYear()}`.trim()
}

/** Whole days remaining in the month (0 on the last day). */
export function daysLeftInMonth(iso = today()): number {
  return daysInMonth(iso) - fromISODate(iso).getDate()
}

/** Whole days since the 1st, 1-based. */
export function dayOfMonth(iso = today()): number {
  return fromISODate(iso).getDate()
}

export function listMonths(count = 12): string[] {
  const out: string[] = []
  let cur = startOfMonth(today())
  for (let i = 0; i < count; i++) {
    out.unshift(cur.slice(0, 7))
    cur = addMonths(cur, -1)
  }
  return out
}

/* ---------- money ---------- */

/** 123456 paise -> "₹1,234.56" using the active currency. */
export function money(paise: number, currency = 'INR', decimals = 2, sign = false): string {
  const value = paise / 100
  const body = value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const sym = symbolFor(currency)
  const prefix = value < 0 ? '−' : sign && value > 0 ? '+' : ''
  return `${prefix}${sym}${body}`
}

/** Compact form for tight chart labels: 1.2L / 45.6K / 2.3Cr. */
export function moneyCompact(paise: number, currency = 'INR'): string {
  const v = Math.abs(paise) / 100
  const sym = symbolFor(currency)
  const sign = paise < 0 ? '−' : ''
  if (v >= 1e7) return `${sign}${sym}${trim(v / 1e7)}Cr`
  if (v >= 1e5) return `${sign}${sym}${trim(v / 1e5)}L`
  if (v >= 1000) return `${sign}${sym}${trim(v / 1000)}K`
  return `${sign}${sym}${Math.round(v).toLocaleString('en-IN')}`
}

function trim(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)
}

export function symbolFor(currency: string): string {
  const map: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', JPY: '¥',
    CAD: 'C$', AUD: 'A$', SGD: 'S$', ZAR: 'R', NGN: '₦', KES: 'KSh ',
  }
  return map[currency] ?? `${currency} `
}

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'ZAR', 'NGN', 'KES']

/** Parse a user-typed amount ("1,234.5", "₹99", "12.") into paise. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, '')
  if (!cleaned || cleaned === '.') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/* ---------- rollups ---------- */

export interface Totals {
  income: number
  expense: number
  net: number
}

export function totalsFor(txs: Tx[]): Totals {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (t.type === 'income') income += t.amount
    else expense += t.amount
  }
  return { income, expense, net: income - expense }
}

export interface CategorySlice {
  category: Category
  amount: number
  share: number
  count: number
}

export function byCategory(txs: Tx[], cats: Map<string, Category>, type: 'expense' | 'income'): CategorySlice[] {
  const sums = new Map<string, { amount: number; count: number }>()
  let total = 0
  for (const t of txs) {
    if (t.type !== type) continue
    const cur = sums.get(t.categoryId) ?? { amount: 0, count: 0 }
    cur.amount += t.amount
    cur.count += 1
    sums.set(t.categoryId, cur)
    total += t.amount
  }
  const out: CategorySlice[] = []
  for (const [id, v] of sums) {
    const category = cats.get(id)
    if (!category) continue
    out.push({
      category,
      amount: v.amount,
      count: v.count,
      share: total > 0 ? v.amount / total : 0,
    })
  }
  return out.sort((a, b) => b.amount - a.amount)
}

/** Six equal time buckets across the month, for the daily-trend chart. */
export interface TrendBucket {
  label: string
  amount: number
  from: number
  to: number
}

export function monthTrend(txs: Tx[], monthIso: string, type: Tx['type'] = 'expense'): TrendBucket[] {
  const total = daysInMonth(monthIso)
  const per = Math.ceil(total / 6)
  const buckets: TrendBucket[] = []
  for (let i = 0; i < 6; i++) {
    const from = i * per + 1
    const to = Math.min(total, (i + 1) * per)
    buckets.push({ label: `${from}`, amount: 0, from, to })
  }
  for (const t of txs) {
    if (t.type !== type) continue
    if (monthKey(t.date) !== monthIso) continue
    const d = dayOfMonth(t.date)
    const idx = Math.min(5, Math.floor((d - 1) / per))
    const b = buckets[idx]
    if (b) b.amount += t.amount
  }
  return buckets
}

/** Compare a month's total to the previous month's. */
export function monthDelta(current: number, previous: number): number | null {
  if (previous === 0) return null
  return (current - previous) / previous
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function settingsOrDefault(s?: Settings | null): Settings {
  return s ?? { id: 'app', currency: 'INR', baseCurrency: 'INR', theme: 'system', overallMonthlyLimit: 0, backupEnabled: false, backupAuto: true, lastBackupAt: null, lastBackupName: null, onboarded: false, decimals: 2 }
}
