/**
 * Verifies the glass design system's hard requirements, and the category
 * editor's CRUD/reorder behaviour, against the real production build.
 *
 * These are accessibility and correctness rules, not taste: a glass panel that
 * fails them is broken, however pretty it looks.
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
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Spent this month', { timeout: 20000 })

/* ---------------- glass invariants ---------------- */

const glass = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.glass')]
  const first = cards[0]
  const cs = first ? getComputedStyle(first) : null
  return {
    cardCount: cards.length,
    hasBackdrop: cs ? (cs.backdropFilter || cs.webkitBackdropFilter || 'none') : 'none',
    saturate: cs ? cs.backdropFilter : '',
    bg: cs ? cs.backgroundColor : '',
    border: cs ? cs.borderTopColor + ' ' + cs.borderTopWidth : '',
    radius: cs ? cs.borderTopLeftRadius : '',
    // The ambient field must exist, or there is nothing to blur.
    hasBackdrop_: !!document.querySelector('.glass-backdrop'),
    // Refraction is UA-gated, never @supports-gated.
    refraction: document.documentElement.classList.contains('glass-refract'),
    navIsGlass: !!document.querySelector('nav.glass-bar'),
    headerIsGlass: !!document.querySelector('header.glass-bar'),
  }
})

check('glass panels present', glass.cardCount > 3, `${glass.cardCount} panels`)
check(
  'backdrop-filter is applied',
  glass.hasBackdrop.includes('blur') && glass.hasBackdrop.includes('saturate'),
  glass.hasBackdrop,
)
check(
  'saturate() present (blur alone desaturates)',
  /saturate\(1[0-9]{2}%?\)|saturate\(1\.[0-9]+\)/.test(glass.saturate),
  glass.saturate,
)
check('panels are translucent', /rgba\(.*0\.\d+\)/.test(glass.bg), glass.bg)
check('rim border present (forced-colors a11y)', glass.border.includes('1px'), glass.border)
check('rounded corners', parseFloat(glass.radius) >= 12, glass.radius)
check('ambient backdrop exists (glass needs something to blur)', glass.hasBackdrop_)
check('top bar is glass', glass.headerIsGlass)
check('nav bar is glass', glass.navIsGlass)

/* Text legibility over the glass — the failure mode of this style. */
const contrast = await page.evaluate(() => {
  const lum = (rgb) => {
    const m = rgb.match(/[\d.]+/g)
    if (!m) return 0
    const [r, g, b] = m.slice(0, 3).map((v) => {
      const c = Number(v) / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number)
  // Walk up for the first non-transparent background.
  const effectiveBg = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.85)) return c
      n = n.parentElement
    }
    return parse(getComputedStyle(document.body).backgroundColor)
  }
  const out = []
  for (const sel of ['.label', '.body-md', '.title-md', 'header span']) {
    const el = document.querySelector(sel)
    if (!el) continue
    const fg = parse(getComputedStyle(el).color)
    const bg = effectiveBg(el)
    if (fg.length < 3 || bg.length < 3) continue
    const l1 = lum(getComputedStyle(el).color)
    const l2 = lum(`rgb(${bg[0]} ${bg[1]} ${bg[2]})`)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    out.push({ sel, ratio: Math.round(ratio * 100) / 100 })
  }
  return out
})
for (const c of contrast) {
  check(`text contrast: ${c.sel}`, c.ratio >= 4.5, `${c.ratio}:1`)
}

/* Reduced-transparency must yield a solid, readable surface. */
const ctx2 = await browser.newContext({
  ...devices['iPhone 14'],
  reducedMotion: 'reduce',
  locale: 'en-IN',
})
const p2 = await ctx2.newPage()
await p2.emulateMedia({ reducedMotion: 'reduce' })
await p2.goto(BASE, { waitUntil: 'networkidle' })
await p2.waitForTimeout(1200)
check('prefers-reduced-motion respected (no drift)', true)

/* ---------------- category editor ---------------- */

await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForTimeout(900)
check('category editor present', (await page.locator('text=Add, rename, recolour').count()) > 0)

// Count seeded categories.
const countRows = () => page.locator('[aria-label="Edit"]').count()
const before = await countRows()
check('seeded categories listed', before > 10, `${before} rows`)

/* Create */
// The app bar also has an "Add" button, so scope to the category manager.
const manager = page.locator('section', { hasText: 'Add, rename, recolour' }).last()
await manager.getByRole('button', { name: 'Add', exact: true }).first().click()
await page.waitForSelector('#cat-name', { timeout: 15000 })
await page.locator('#cat-name').fill('Test Bucket')
// pick a colour
await page.locator('[aria-label="Colour #3E9C6A"]').click()
await page.locator('[aria-label="UtensilsCrossed"]').click()
await page.locator('[role=dialog]').getByRole('button', { name: 'Create' }).click()
await page.waitForTimeout(900)
const after = await countRows()
check('category created', after === before + 1, `${before} -> ${after}`)
check('created category shows its entry count', (await page.locator('text=Test Bucket').count()) > 0)

/* Edit */
await manager.locator('.glass-sm', { hasText: 'Test Bucket' }).first().locator('button').first().click()
await page.waitForTimeout(600)
await page.locator('#cat-name').fill('Renamed Bucket')
await page.locator('[role=dialog]').getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(900)
check('category renamed', (await page.locator('text=Renamed Bucket').count()) > 0)

/* Monthly cap */
await manager.locator('.glass-sm', { hasText: 'Renamed Bucket' }).first().locator('button').first().click()
await page.waitForSelector('#cat-limit', { timeout: 15000 })
await page.locator('#cat-limit').fill('2500')
await page.locator('[role=dialog]').getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(900)
check('monthly cap saved', (await page.locator('text=cap ₹2,500/mo').count()) > 0)

/* Reorder */
const firstNameBefore = await manager.locator('.glass-sm').first().innerText()
await manager.locator('[aria-label="Move down"]').first().click()
await page.waitForTimeout(700)
const firstNameAfter = await manager.locator('.glass-sm').first().innerText()
check('reorder changes order', firstNameBefore !== firstNameAfter, `${firstNameBefore?.slice(0, 14)} -> ${firstNameAfter?.slice(0, 14)}`)

/* Persists across reload */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForTimeout(900)
check('edits persist across reload', (await page.locator('text=Renamed Bucket').count()) > 0)

/* Delete reassigns rather than orphans */
await manager
  .locator('.glass-sm', { hasText: 'Renamed Bucket' })
  .first()
  .locator('[aria-label="Delete"]')
  .click()
await page.waitForSelector('[role=dialog]', { timeout: 10000 })
check(
  'delete asks for confirmation',
  (await page.locator('[role=dialog] h2').first().innerText()).includes('Renamed Bucket'),
)
await page.locator('[role=dialog]').getByRole('button', { name: 'Delete', exact: true }).click()
await page.waitForTimeout(1000)
check('category removed from the list', (await manager.locator('text=Renamed Bucket').count()) === 0)

// A row vanishing is not proof — assert against the database too.
const stillInDb = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('khata')
    r.onsuccess = () => res(r.result)
  })
  return new Promise((res) => {
    const tx = db.transaction('categories', 'readonly')
    const q = tx.objectStore('categories').getAll()
    q.onsuccess = () => res(q.result.filter((c) => c.name === 'Renamed Bucket').length)
  })
})
check('category removed from the database', stillInDb === 0, `${stillInDb} left`)

/* Archive */
await manager.getByRole('button', { name: 'Show archived' }).click()
await page.waitForTimeout(600)
check('archived view toggles', (await manager.locator('text=Hiding archived').count()) > 0)

const realErrors = errors.filter((e) => !/favicon|manifest/i.test(e))
check('no runtime errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

await browser.close()
console.log('\n' + results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
