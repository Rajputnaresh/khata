/**
 * Insight engine — the "so what" layer over raw transactions.
 * Everything is computed locally from IndexedDB; no network, no LLM.
 */

import type { Category, Tx } from './types'
import { byCategory, daysInMonth, daysLeftInMonth, dayOfMonth, money, monthKey, pct, startOfMonth, today, totalsFor } from './util'

export type Severity = 'good' | 'warn' | 'bad' | 'info'

export interface Insight {
  id: string
  severity: Severity
  title: string
  detail: string
  /** Optional headline figure rendered large in the card. */
  value?: string
  /** Category accent, for a leading rule on the card. */
  color?: string
}

export interface Runway {
  days: number
  dailyBurn: number
  state: 'ok' | 'tight' | 'critical'
}

export interface Analysis {
  monthIso: string
  totals: { income: number; expense: number; net: number }
  prevExpense: number
  prevNet: number
  expenseTrend: number | null
  budget: number
  budgetUsed: number
  budgetLeft: number
  projected: number
  runway: Runway
  savingsRate: number | null
  topCategories: ReturnType<typeof byCategory>
  largest: Tx | null
  topMerchant: { name: string; amount: number; count: number } | null
  streak: { current: number; best: number }
  dayCount: number
  avgPerDay: number
  topDay: { date: string; amount: number } | null
  weekdayHeavy: { label: string; amount: number } | null
  anomalies: Tx[]
  recurringTotal: number
  insights: Insight[]
}

/** Rough merchant extraction from a free-text note. */
function merchantOf(note: string): string | null {
  const cleaned = note
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[0-9]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 3) return null
  return cleaned
    .split(/[,|/]|\s+at\s+|\s+-\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 32)[0] ?? null
}

export function analyse(opts: {
  monthTxs: Tx[]
  prevMonthTxs: Tx[]
  cats: Map<string, Category>
  settings: { currency: string; decimals: number; overallMonthlyLimit: number }
}): Analysis {
  const { monthTxs, prevMonthTxs, cats, settings } = opts
  const prev = totalsFor(prevMonthTxs)
  const monthIso = monthTxs[0] ? monthKey(monthTxs[0].date) : startOfMonth(today())
  const cur = totalsFor(monthTxs)
  const days = daysInMonth(monthIso)
  const elapsed = Math.min(dayOfMonth(today()), days)
  const expenses = monthTxs.filter((t) => t.type === 'expense' && t.status === 'cleared')

  // Straight-line projection to month end. The honest baseline for "am I on track".
  const projected = elapsed > 0 ? Math.round((cur.expense / elapsed) * days) : 0
  const budget = settings.overallMonthlyLimit
  const budgetUsed = budget > 0 ? cur.expense / budget : 0
  const dailyBurn = elapsed > 0 ? cur.expense / elapsed : 0

  let runwayState: Runway['state'] = 'ok'
  let runwayDays = 0
  if (dailyBurn > 0 && cur.net > 0) {
    // Runway is "how many days of current burn the month's surplus covers".
    // Cap it: a savings buffer is not an infinite cushion, and an absurd
    // figure ("6637 days") is noise, not information. Past a year it simply
    // means "well covered".
    const raw = Math.round(cur.net / dailyBurn)
    runwayDays = Math.min(raw, 365)
    runwayState = raw <= 7 ? 'tight' : 'ok'
  }

  const savingsRate = cur.income > 0 ? cur.net / cur.income : null

  // Statistical confidence. A single entry proves nothing about a "trend",
  // "heavy weekday" or category share, so those insights stay silent until
  // there is enough data behind them.
  const hasVolume = expenses.length >= 8
  const hasVolumeStrict = expenses.length >= 15

  const topCategories = byCategory(monthTxs, cats, 'expense')
  const largest = expenses.reduce<Tx | null>((max, t) => (!max || t.amount > max.amount ? t : max), null)

  // Merchant rollup.
  const merchantMap = new Map<string, { amount: number; count: number }>()
  for (const t of expenses) {
    const m = merchantOf(t.note)
    if (!m) continue
    const e = merchantMap.get(m) ?? { amount: 0, count: 0 }
    e.amount += t.amount
    e.count += 1
    merchantMap.set(m, e)
  }
  let topMerchant: Analysis['topMerchant'] = null
  for (const [name, v] of merchantMap) {
    if (!topMerchant || v.amount > topMerchant.amount) topMerchant = { name, ...v }
  }

  // Daily streaks: consecutive calendar days with at least one expense.
  const byDay = new Map<string, number>()
  for (const t of expenses) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount)
  const daysWithSpend = new Set(byDay.keys())
  let current = 0
  const sortedDays = [...daysWithSpend].sort()
  if (sortedDays.length) {
    const last = sortedDays[sortedDays.length - 1]!
    // Anchor the streak at the most recent logged day, or yesterday if today is empty.
    const anchor = last === today() || last === isoMinus(today(), 1) ? last : isoMinus(last, 0)
    let cursor = anchor
    while (daysWithSpend.has(cursor)) {
      current += 1
      cursor = isoMinus(cursor, 1)
    }
  }
  let best = current

  let topDay: Analysis['topDay'] = null
  for (const [date, amount] of byDay) {
    if (!topDay || amount > topDay.amount) topDay = { date, amount }
  }

  // Weekday concentration.
  const DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dowMap = new Map<number, number>()
  for (const t of expenses) {
    const d = new Date(t.date).getDay()
    dowMap.set(d, (dowMap.get(d) ?? 0) + t.amount)
  }
  let weekdayHeavy: Analysis['weekdayHeavy'] = null
  for (const [d, amount] of dowMap) {
    if (!weekdayHeavy || amount > weekdayHeavy.amount) weekdayHeavy = { label: DOWS[d] ?? '', amount }
  }

  // Anomalies: a single entry >2.5x the category's average for the month.
  const anomalies: Tx[] = []
  for (const slice of topCategories) {
    const inCat = expenses.filter((t) => t.categoryId === slice.category.id)
    if (inCat.length < 4) continue
    const mean = inCat.reduce((a, t) => a + t.amount, 0) / inCat.length
    for (const t of inCat) if (t.amount > mean * 2.5) anomalies.push(t)
  }
  anomalies.sort((a, b) => b.amount - a.amount)

  const recurringTotal = monthTxs.filter((t) => t.recurring).reduce((a, t) => a + t.amount, 0)

  const analysis: Analysis = {
    monthIso,
    totals: cur,
    prevExpense: prev.expense,
    prevNet: prev.net,
    expenseTrend: prev.expense > 0 ? (cur.expense - prev.expense) / prev.expense : null,
    budget,
    budgetUsed,
    budgetLeft: budget - cur.expense,
    projected,
    runway: { days: runwayDays, dailyBurn, state: runwayState },
    savingsRate,
    topCategories,
    largest,
    topMerchant,
    streak: { current, best },
    dayCount: byDay.size,
    avgPerDay: byDay.size > 0 ? Math.round(cur.expense / byDay.size) : 0,
    topDay,
    weekdayHeavy,
    anomalies,
    recurringTotal,
    insights: [],
  }
  analysis.insights = buildInsights(analysis, cats, settings.currency, settings.decimals, {
    hasVolume,
    hasVolumeStrict,
    entryCount: expenses.length,
  })
  return analysis
}

function topCategoriesCount(a: Analysis): number {
  return a.topCategories.length
}

function isoMinus(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function buildInsights(
  a: Analysis,
  cats: Map<string, Category>,
  cur: string,
  decimals: number,
  confidence: { hasVolume: boolean; hasVolumeStrict: boolean; entryCount: number },
): Insight[] {
  const out: Insight[] = []
  const m = (p: number) => money(p, cur, decimals)
  const { hasVolume, hasVolumeStrict, entryCount } = confidence

  if (a.totals.income === 0 && a.totals.expense > 0) {
    out.push({
      id: 'no-income',
      severity: 'info',
      title: 'No income logged this month',
      detail:
        'Add a salary entry and Khata can show savings rate, runway and trend against last month.',
    })
  }

  // Be explicit about confidence instead of dressing up thin data as insight.
  if (entryCount > 0 && entryCount < 8) {
    out.push({
      id: 'more-data',
      severity: 'info',
      title: `Logging ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} so far`,
      detail: `Add ${8 - entryCount} more this month and Khata will start showing trends, category shares and anomaly checks that are actually reliable.`,
    })
  }

  // A month-over-month delta off one or two entries is noise, so only claim a
  // "trend" once this month has real volume behind it.
  if (a.expenseTrend !== null && hasVolume) {
    const up = a.expenseTrend > 0
    const strong = Math.abs(a.expenseTrend) >= 0.15
    out.push({
      id: 'trend',
      severity: up ? (strong ? 'bad' : 'warn') : 'good',
      title: up
        ? `Spending up ${pct(a.expenseTrend)} vs last month`
        : `Spending down ${pct(-a.expenseTrend)} vs last month`,
      detail: up
        ? `You are on track to spend ${m(a.projected)} this month. That is ${m(
            a.projected - a.prevExpense,
          )} more than last month.`
        : `Trimmed ${m(a.prevExpense - a.totals.expense)} compared with last month. Keep the streak going.`,
      value: m(a.projected),
    })
  }

  if (a.budget > 0) {
    const left = a.budgetLeft
    const daysLeft = daysLeftInMonth()
    const safeDaily = daysLeft > 0 ? Math.max(0, left) / daysLeft : 0
    if (left < 0) {
      out.push({
        id: 'budget-over',
        severity: 'bad',
        title: `Over budget by ${m(-left)}`,
        detail: `Budget is ${m(a.budget)}. You are ${pct(a.budgetUsed)} of the way through with ${
          daysLeft
        } day${daysLeft === 1 ? '' : 's'} left.`,
        value: m(-left),
      })
    } else {
      out.push({
        id: 'budget-ok',
        severity: safeDaily >= a.runway.dailyBurn ? 'good' : 'warn',
        title: `${m(left)} left in the budget`,
        detail: `Safe to spend about ${m(Math.round(safeDaily))} a day for the remaining ${daysLeft} day${
          daysLeft === 1 ? '' : 's'
        }. Your month-to-date average is ${m(a.runway.dailyBurn)}.`,
        value: m(left),
      })
    }
  } else {
    out.push({
      id: 'no-budget',
      severity: 'info',
      title: 'Set a monthly budget',
      detail: 'Khata will then track burn rate, safe-to-spend and runway against a target you choose.',
    })
  }

  const top = a.topCategories[0]
  // With one or two entries the top category is trivially 100% of spending,
  // which tells the user nothing. Hold this card back until there is a spread.
  if (top && a.totals.expense > 0 && (hasVolume || topCategoriesCount(a) > 1)) {
    out.push({
      id: 'top-cat',
      severity: 'info',
      title: `${top.category.name} leads at ${pct(top.share)}`,
      detail: `${m(top.amount)} across ${top.count} transaction${top.count === 1 ? '' : 's'}.${
        cats.get(top.category.id)?.monthlyLimit
          ? ` Category cap is ${m(cats.get(top.category.id)!.monthlyLimit)}.`
          : ''
      }`,
      value: m(top.amount),
      color: top.category.color,
    })
  }

  // One big entry dominating the month is only notable alongside other spending.
  if (a.largest && a.totals.expense > 0 && hasVolume && a.largest.amount / a.totals.expense > 0.2) {
    out.push({
      id: 'largest',
      severity: 'warn',
      title: `One entry is ${pct(a.largest.amount / a.totals.expense)} of the month`,
      detail: `${m(a.largest.amount)} — ${a.largest.note || 'no note'} on ${
        cats.get(a.largest.categoryId)?.name ?? 'uncategorised'
      }.`,
      value: m(a.largest.amount),
    })
  }

  if (a.anomalies.length) {
    const worst = a.anomalies[0]!
    out.push({
      id: 'anomaly',
      severity: 'warn',
      title: 'Unusual spike in spending',
      detail: `${m(worst.amount)} in ${cats.get(worst.categoryId)?.name ?? 'a category'} on ${
        worst.date
      } is more than 2.5x the usual amount there.`,
      value: m(worst.amount),
    })
  }

  if (a.runway.state === 'critical' && a.runway.dailyBurn > 0) {
    out.push({
      id: 'runway-critical',
      severity: 'bad',
      title: 'No savings buffer this month',
      detail: `Income and spending are level, so there is no runway if an expense lands. Current burn is ${m(
        a.runway.dailyBurn,
      )} a day.`,
    })
  } else if (a.runway.days > 0) {
    out.push({
      id: 'runway',
      severity: a.runway.state === 'tight' ? 'warn' : 'good',
      title: `${a.runway.days} days of runway`,
      detail: `Surplus of ${m(a.totals.net)} covers ${a.runway.days} days at your current ${m(
        a.runway.dailyBurn,
      )} daily burn.`,
      value: m(a.totals.net),
    })
  }

  if (a.savingsRate !== null) {
    const rate = a.savingsRate
    out.push({
      id: 'savings',
      severity: rate >= 0.2 ? 'good' : rate >= 0.05 ? 'warn' : 'bad',
      title: `Savings rate ${pct(rate)}`,
      detail:
        rate >= 0.3
          ? 'Excellent. You are keeping more than 30% of what you earn.'
          : rate >= 0.2
            ? 'Healthy. The usual benchmark is 20% of income saved.'
            : rate >= 0
              ? 'Below the 20% benchmark. Trim one or two recurring lines to move it.'
              : 'You spent more than you earned this month.',
      value: `${Math.round(rate * 100)}%`,
    })
  }

  if (a.topMerchant && a.topMerchant.count > 1) {
    out.push({
      id: 'merchant',
      severity: 'info',
      title: `Most spent at ${a.topMerchant.name}`,
      detail: `${m(a.topMerchant.amount)} over ${a.topMerchant.count} visit${
        a.topMerchant.count === 1 ? '' : 's'
      } this month.`,
      value: m(a.topMerchant.amount),
    })
  }

  if (a.streak.current >= 3) {
    out.push({
      id: 'streak',
      severity: 'info',
      title: `${a.streak.current}-day logging streak`,
      detail: `You have recorded spending on ${a.streak.current} consecutive days. Longest this month: ${
        a.streak.best
      }.`,
    })
  }

  // A "heavy weekday" needs enough entries that some weekday genuinely repeats.
  if (hasVolumeStrict && a.weekdayHeavy && a.weekdayHeavy.amount / Math.max(1, a.totals.expense) > 0.28) {
    out.push({
      id: 'weekday',
      severity: 'info',
      title: `${a.weekdayHeavy.label}s are your heavy day`,
      detail: `${pct(a.weekdayHeavy.amount / a.totals.expense)} of the month's spending lands on a ${
        a.weekdayHeavy.label
      }. Worth planning a cheaper option.`,
      value: m(a.weekdayHeavy.amount),
    })
  }

  if (a.recurringTotal > 0) {
    out.push({
      id: 'recurring',
      severity: 'info',
      title: `${m(a.recurringTotal)} in recurring costs`,
      detail: `${a.totals.expense > 0 ? pct(a.recurringTotal / a.totals.expense) : '0%'} of the month is marked recurring. ` +
        'These are the first lines to attack when cutting costs.',
    })
  }

  const order: Record<Severity, number> = { bad: 0, warn: 1, good: 2, info: 3 }
  return out.sort((x, y) => order[x.severity] - order[y.severity])
}
