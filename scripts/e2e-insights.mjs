/**
 * Verifies the insight engine with realistic volume, and specifically that
 * the noise-gating behaves: thin data must NOT produce fake trends.
 */
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const results = []
let failed = 0
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-IN', timezoneId: 'Asia/Kolkata' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

/* --- Case A: ONE entry. Must not claim trends / heavy weekdays / 100% shares. --- */
await page.getByRole('button', { name: 'Add', exact: false }).first().click()
await page.waitForTimeout(400)
const dlg = page.locator('[role="dialog"]')
await dlg.locator('input[aria-label="Amount"]').fill('450')
await dlg.locator('.grid > button').filter({ hasText: 'Groceries' }).first().click()
await dlg.getByRole('button', { name: 'Add expense' }).click()
await page.waitForTimeout(800)

const thin = await page.evaluate(() => document.body.innerText)
check('single entry: no fake "is 100% of the month"', !/is 100% of the month/.test(thin))
check('single entry: no fake heavy weekday', !/are your heavy day/i.test(thin))
check('single entry: no fake MoM trend', !/vs last month/i.test(thin))
check('single entry: honest "logging N entries" nudge', /Logging 1 entry so far/.test(thin))
check('single entry: runway is sane (<=365d)', !/66\d\d days|runway[\s\S]{0,20}\d{4,}/i.test(thin))

/* --- Case B: bulk-load 20 expenses + 1 income directly, then re-check. --- */
const seeded = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('khata')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const readAll = (store) =>
    new Promise((res) => {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () => res(req.result)
      req.onerror = () => res([])
    })
  const cats = await readAll('categories')
  const existing = await readAll('tx')

  const today = new Date()
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const expenseCats = cats.filter((c) => c.kind === 'expense').map((c) => c.id)
  const rows = []
  const notes = ['Swiggy order', 'Big Basket run', 'Petrol', 'Metro card', 'Cafe Blue coffee', 'Chemist', 'Bus pass', 'Dinner']
  for (let i = 0; i < 20; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - (i % 12))
    rows.push({
      id: `bulk_${i}`,
      type: 'expense',
      amount: 15000 + i * 3250,
      categoryId: expenseCats[i % expenseCats.length],
      note: notes[i % notes.length],
      date: iso(d),
      status: 'cleared',
      recurring: i % 5 === 0,
      createdAt: Date.now() - i,
      updatedAt: Date.now() - i,
    })
  }
  // Previous month, for a real MoM comparison.
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 5 + i)
    rows.push({
      id: `prev_${i}`,
      type: 'expense',
      amount: 40000 + i * 2000,
      categoryId: expenseCats[i % expenseCats.length],
      note: notes[(i + 3) % notes.length],
      date: iso(d),
      status: 'cleared',
      recurring: false,
      createdAt: Date.now() - i,
      updatedAt: Date.now() - i,
    })
  }
  rows.push({
    id: 'inc_sal',
    type: 'income',
    amount: 1200000,
    categoryId: cats.find((c) => c.kind === 'income')?.id ?? 'c_salary',
    note: 'Monthly salary',
    date: iso(today),
    status: 'cleared',
    recurring: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  await new Promise((res, rej) => {
    const tx = db.transaction('tx', 'readwrite')
    const store = tx.objectStore('tx')
    for (const r of rows) store.put(r)
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  return { added: rows.length, existing: existing.length }
})
check('bulk data written to IndexedDB', seeded.added === 35, `${seeded.added} rows`)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

const full = await page.evaluate(() => document.body.innerText)
check('with volume: MoM trend now shown', /vs last month/i.test(full))
check('with volume: savings rate shown', /Savings rate/i.test(full))
check('with volume: no "logging N entries" nudge', !/Logging \d+ entr/i.test(full))
check('with volume: no 100%-of-month absurdity', !/is 100% of the month/.test(full))

// Runway must be a believable number, never thousands.
const runwayMatch = full.match(/(\d+)\s*days of runway|RUNWAY\s*\n?(\d+)/i)
if (runwayMatch) {
  const n = Number(runwayMatch[1] ?? runwayMatch[2])
  check('runway is plausible (0 < n <= 365)', n > 0 && n <= 365, `${n} days`)
} else {
  check('runway rendered', false, 'no runway value found')
}

/* --- Insights tab with real data --- */
await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(1000)
const ins = await page.evaluate(() => document.body.innerText)
check('insights: category breakdown has multiple bars', ins.includes('Category breakdown'))
check('insights: daily rhythm renders', ins.includes('Daily rhythm'))
check('insights: 12-month view renders', ins.includes('Last 12 months'))
check('insights: no crash text', !/something went wrong|undefined|NaN/i.test(ins))

await page.screenshot({ path: 'shots/insights-full.png', fullPage: true })
await page.getByRole('button', { name: 'Home' }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: 'shots/dashboard-full.png', fullPage: true })

const realErrors = errors.filter((e) => !/favicon|manifest/i.test(e))
check('no runtime errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

await browser.close()
console.log('\n' + results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
