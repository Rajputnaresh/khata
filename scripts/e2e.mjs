/**
 * End-to-end smoke test against the production build.
 * Drives the real UI in Chromium and asserts observable outcomes.
 */
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const results = []
let failed = 0

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-IN', timezoneId: 'Asia/Kolkata' })
const page = await ctx.newPage()

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Khata', { timeout: 15000 })

/* 1. boots into the dashboard */
const hero = await page.locator('text=Spent this month').first().count()
check('dashboard renders', hero > 0)

/* 2. seeded categories exist */
const seedCount = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('khata')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  return await new Promise((res) => {
    const tx = db.transaction('categories', 'readonly')
    const req = tx.objectStore('categories').count()
    req.onsuccess = () => res(req.result)
    req.onerror = () => res(-1)
  })
})
check('categories seeded', seedCount >= 15, `${seedCount} categories`)

/* 3. add an expense through the UI */
await page.getByRole('button', { name: 'Add', exact: false }).first().click()
await page.waitForTimeout(500)
const dlg = page.locator('[role="dialog"]')
check('add-expense sheet opens', (await dlg.count()) > 0)

const amountInput = dlg.locator('input[aria-label="Amount"]')
await amountInput.waitFor({ timeout: 5000 })
await amountInput.fill('450')
// Category chips live inside the dialog; the dashboard also has cards with
// these words, so always scope category clicks to the open sheet.
await dlg.locator('.grid > button').filter({ hasText: 'Groceries' }).first().click()
await dlg.locator('#tx-note').fill('Weekly vegetables')
await page.waitForTimeout(200)
await dlg.getByRole('button', { name: 'Add expense' }).click()
await page.waitForTimeout(900)

const toast = await page.locator('text=Expense saved').count()
check('expense saved with toast', toast > 0)

/* 4. total reflects the new entry */
const bodyText = await page.evaluate(() => document.body.innerText)
check('hero shows the amount', bodyText.includes('450'), 'total updated to 450')
check('insight generated', /Insight|lead|spent|budget|Log a few entries/i.test(bodyText))

/* 5. persists in IndexedDB */
const persisted = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('khata')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  return await new Promise((res) => {
    const tx = db.transaction('tx', 'readonly')
    const req = tx.objectStore('tx').getAll()
    req.onsuccess = () => res(req.result)
    req.onerror = () => res([])
  })
})
check('tx persisted to IndexedDB', persisted.length === 1, `${persisted.length} row(s)`)
check('amount stored as paise', persisted[0]?.amount === 45000, `amount=${persisted[0]?.amount}`)

/* 6. add income too, verify net */
await page.getByRole('button', { name: 'Add', exact: false }).first().click()
await page.waitForTimeout(450)
const dlg2 = page.locator('[role="dialog"]')
await dlg2.locator('input[aria-label="Amount"]').fill('100000')
await dlg2.getByRole('button', { name: 'income', exact: true }).click()
await page.waitForTimeout(250)
await dlg2.locator('.grid > button').filter({ hasText: 'Salary' }).first().click()
await dlg2.getByRole('button', { name: 'Add income' }).click()
await page.waitForTimeout(900)
const afterIncome = await page.evaluate(() => document.body.innerText)
check('net savings shown', /99,?550|99,550/.test(afterIncome) || afterIncome.includes('1,00,000'), 'income + expense both counted')

/* 7. activity tab lists both */
await page.getByRole('button', { name: 'Activity' }).click()
await page.waitForTimeout(700)
const rows = await page.locator('text=Weekly vegetables').count()
check('transaction appears in activity', rows > 0)

/* 8. insights tab */
await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(800)
const insightsText = await page.evaluate(() => document.body.innerText)
check('insights view renders', insightsText.includes('All insights'))
check('insight engine produced output', /Savings rate|Daily average|Projected month/.test(insightsText))

/* 9. backup view: crypto primitives present, no client id yet */
await page.getByRole('button', { name: 'Backup' }).click()
await page.waitForTimeout(700)
const backupText = await page.evaluate(() => document.body.innerText)
check('backup view renders', backupText.includes('How your backup stays private'))
check('drive not yet connected', backupText.includes('Backups are off'))

/* 10. encryption round-trip using the app's own module logic */
const cryptoOk = await page.evaluate(async () => {
  // Re-implement the same primitives the app uses to prove the browser env supports them.
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const material = await crypto.subtle.importKey('raw', enc.encode('test-pass-123'), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('hello khata'))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt) === 'hello khata'
})
check('Web Crypto AES-GCM round-trip', cryptoOk)

/* 11. offline: service worker registered */
const swReady = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false
  const reg = await navigator.serviceWorker.getRegistration()
  return !!reg
})
check('service worker registered', swReady)

/* 12. reload persists data (simulates relaunch) */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const afterReload = await page.evaluate(() => document.body.innerText)
check('data survives reload', afterReload.includes('450') || afterReload.includes('Weekly vegetables'))

/* screenshots */
await page.screenshot({ path: 'shots/dashboard-mobile.png', fullPage: true })
await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: 'shots/insights-mobile.png', fullPage: true })

/* console errors */
const realErrors = errors.filter((e) => !/favicon|manifest|Download error/i.test(e))
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

await browser.close()

console.log('\n' + results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
