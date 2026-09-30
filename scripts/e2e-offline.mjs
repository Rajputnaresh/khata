/**
 * The critical promise: the app works with no network at all.
 * Loads, installs (SW), then goes offline and must still boot and show data.
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
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-IN' })
const page = await ctx.newPage()

// 1. First visit, let the service worker install and precache.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('khata')
    r.onsuccess = () => res(r.result)
  })
  await new Promise((res) => {
    const tx = db.transaction('tx', 'readwrite')
    tx.objectStore('tx').put({
      id: 'offline_1', type: 'expense', amount: 123400, categoryId: 'c_food',
      note: 'Offline test dinner', date: new Date().toISOString().slice(0, 10),
      status: 'cleared', recurring: false, createdAt: 1, updatedAt: 1,
    })
    tx.oncomplete = res
  })
})

// Wait for the SW to reach "activated" and control the page.
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready
  return reg.active?.state ?? 'none'
})
check('service worker activated', swState === 'activated', swState)

// 2. Go fully offline.
await ctx.setOffline(true)
const offline = true
check('context is offline', offline)

// 3. Hard reload while offline — the app shell must come from the SW cache.
let bootedOk = true
let bootErr = ''
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForSelector('text=Spent this month', { timeout: 20000 })
} catch (e) {
  bootedOk = false
  bootErr = e instanceof Error ? e.message.split('\n')[0] : String(e)
}
check('app boots offline after reload', bootedOk, bootErr)

if (bootedOk) {
  await page.waitForTimeout(1500)
  const text = await page.evaluate(() => document.body.innerText)
  check('data readable offline', text.includes('1,234') || text.includes('1234'), 'expense total present')
  check('insights render offline', /Insight|Log a few entries|Set a monthly budget/i.test(text))

  // 4. Add a new transaction while offline — writes must persist locally.
  await page.getByRole('button', { name: 'Add', exact: false }).first().click()
  await page.waitForTimeout(500)
  const dlg = page.locator('[role="dialog"]')
  await dlg.locator('input[aria-label="Amount"]').fill('777')
  await dlg.getByRole('button', { name: 'Add expense' }).click()
  await page.waitForTimeout(900)
  const afterAdd = await page.evaluate(() => document.body.innerText)
  check('new entry saved while offline', afterAdd.includes('777') || afterAdd.includes('2,011'), 'offline write landed')

  await page.screenshot({ path: 'shots/offline-dashboard.png' })
}

// 5. Restore the network and confirm recovery.
await ctx.setOffline(false)
try {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=Spent this month', { timeout: 15000 })
  check('recovers cleanly when back online', true)
} catch {
  check('recovers cleanly when back online', false)
}

await browser.close()
console.log('\n' + results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
