/**
 * Final gate: the live HTTPS deployment must be installable, offline-capable
 * and fully functional. This is the URL the phone will actually use.
 */
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'https://rajputnaresh.github.io/khata/'
const results = []
let failed = 0
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-IN' })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

check('served over HTTPS', BASE.startsWith('https://'))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Spent this month', { timeout: 20000 })
check('app boots on live URL', true)
check('title correct', (await page.title()).includes('Khata'), await page.title())

// Manifest is served and valid.
const manifest = await page.evaluate(async () => {
  const res = await fetch(document.querySelector('link[rel=manifest]').href)
  return res.ok ? res.json() : null
})
check('manifest served', !!manifest)
check('manifest is standalone + named', manifest?.display === 'standalone' && !!manifest?.name, manifest?.name)
check('manifest has 192+512 icons', manifest?.icons?.length >= 2, `${manifest?.icons?.length} icons`)
check('manifest has screenshots', (manifest?.screenshots?.length ?? 0) >= 2)

// Every declared icon actually resolves.
const iconOk = await page.evaluate(async (icons) => {
  for (const i of icons) {
    const url = new URL(i.src, location.href).href
    const r = await fetch(url)
    if (!r.ok) return `missing: ${i.src}`
  }
  return 'ok'
}, manifest.icons)
check('all manifest icons resolve', iconOk === 'ok', iconOk)

// Installability signals.
check('apple touch icon present', await page.locator('link[rel="apple-touch-icon"]').count() > 0)
check('theme-color meta present', await page.locator('meta[name="theme-color"]').count() > 0)
check('viewport meta present', await page.locator('meta[name=viewport]').count() > 0)

// A freshly-installed worker transitions to "activated" a moment after load;
// poll the registration rather than sampling once.
const swState = await page.evaluate(async () => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const regs = await navigator.serviceWorker.getRegistrations()
    const active = regs.find((r) => r.active?.state === 'activated')
    if (active) return 'activated'
    await new Promise((r) => setTimeout(r, 250))
  }
  const regs = await navigator.serviceWorker.getRegistrations()
  return regs[0]?.active?.state ?? 'none'
})
check('service worker active on live site', swState === 'activated', swState)

// It must also control the page, which is what makes offline boot work.
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller)
check('service worker controls the page', controlled)

// Functional check: add a transaction on the live deployment.
await page.getByRole('button', { name: 'Add', exact: false }).first().click()
await page.waitForTimeout(500)
const dlg = page.locator('[role="dialog"]')
await dlg.locator('input[aria-label="Amount"]').fill('1234.50')
await dlg.locator('#tx-note').fill('Live deploy test')
await dlg.getByRole('button', { name: 'Add expense' }).click()
await page.waitForTimeout(1000)
const text = await page.evaluate(() => document.body.innerText)
check('transaction saves on live site', text.includes('1,234') || text.includes('1234'), 'total updated')

// Offline on the real domain.
await ctx.setOffline(true)
let offlineOk = false
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForSelector('text=Spent this month', { timeout: 20000 })
  offlineOk = true
} catch { /* stays false */ }
check('works offline on live domain', offlineOk)
await ctx.setOffline(false)

const realErrs = errs.filter((e) => !/favicon|manifest/i.test(e))
check('no runtime errors on live site', realErrs.length === 0, realErrs.slice(0, 2).join(' | '))

await browser.close()
console.log('\n' + results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
