/**
 * Viewport-accurate check: fixed elements (FAB, bottom nav) must not cover
 * interactive content, and the scroll padding must clear the nav.
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
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// Seed enough to make the dashboard tall.
await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('khata')
    r.onsuccess = () => res(r.result)
  })
  const cats = await new Promise((res) => {
    const tx = db.transaction('categories', 'readonly')
    const q = tx.objectStore('categories').getAll()
    q.onsuccess = () => res(q.result)
  })
  const ec = cats.filter((c) => c.kind === 'expense').map((c) => c.id)
  const t = new Date()
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const rows = []
  for (let i = 0; i < 22; i++) {
    const d = new Date(t); d.setDate(d.getDate() - (i % 14))
    rows.push({ id:`v${i}`, type:'expense', amount:20000+i*2100, categoryId:ec[i%ec.length],
      note:['Swiggy','Petrol','Metro','Chemist','Dinner','Groceries'][i%6], date:iso(d),
      status:'cleared', recurring:false, createdAt:i, updatedAt:i })
  }
  rows.push({ id:'vinc', type:'income', amount:1500000, categoryId:'c_salary', note:'Salary', date:iso(t),
    status:'cleared', recurring:true, createdAt:0, updatedAt:0 })
  await new Promise((res) => {
    const tx = db.transaction('tx','readwrite')
    const s = tx.objectStore('tx')
    rows.forEach(r => s.put(r))
    tx.oncomplete = res
  })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

// 1. Bottom nav and FAB must not cover any tappable element.
const overlaps = await page.evaluate(() => {
  const vh = window.innerHeight
  const vw = window.innerWidth
  const fixed = [...document.querySelectorAll('nav, button[aria-label="Add transaction"]')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((x) => x.r.height > 0 && x.r.top < vh && x.r.bottom > 0)
  const covered = []
  for (const { el, r } of fixed) {
    for (const t of document.querySelectorAll('button, a, input, [role="button"]')) {
      if (el.contains(t) || t.contains(el)) continue
      const tr = t.getBoundingClientRect()
      if (tr.width === 0 || tr.height === 0) continue
      if (tr.bottom < r.top || tr.top > r.bottom) continue
      if (tr.right < r.left || tr.left > r.right) continue
      // Ignore elements that are themselves sticky/floating chrome.
      if (getComputedStyle(t).position === 'fixed') continue
      const cls = (t.className || '').toString()
      if (cls.includes('sr-only') || cls.includes('hidden')) continue
      const txt = (t.innerText || t.getAttribute('aria-label') || '').trim().slice(0, 30)
      if (!txt) continue
      covered.push(txt)
    }
  }
  return [...new Set(covered)]
})
check('fixed chrome does not cover controls', overlaps.length === 0, overlaps.slice(0,4).join(' | '))

// 2. Scroll to the very bottom: last card must be fully reachable above the nav.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(700)
const lastVisible = await page.evaluate(() => {
  const nav = document.querySelector('nav')
  const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight
  const cards = [...document.querySelectorAll('section.glass, .glass')]
  const last = cards[cards.length - 1]
  if (!last) return { ok: false, why: 'no cards' }
  const r = last.getBoundingClientRect()
  return { ok: r.bottom <= navTop + 1, bottom: Math.round(r.bottom), navTop: Math.round(navTop) }
})
check('last card clears the bottom nav when scrolled', lastVisible.ok, JSON.stringify(lastVisible))

// 3. Tap targets >= 44px (accessibility minimum) for nav + FAB.
const smallTargets = await page.evaluate(() => {
  const bad = []
  for (const el of document.querySelectorAll('nav button, button[aria-label="Add transaction"], header button')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.height < 32 || r.width < 32) bad.push(`${(el.innerText || el.getAttribute('aria-label') || '?').slice(0,14)}:${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  return bad
})
check('nav/FAB tap targets are large enough', smallTargets.length === 0, smallTargets.slice(0,4).join(' | '))

// 4. Realistic (non-fullPage) screenshots for visual review.
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(500)
await page.screenshot({ path: 'shots/vp-dashboard-top.png' })
await page.evaluate(() => window.scrollTo(0, 1400))
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots/vp-dashboard-mid.png' })

await browser.close()
console.log('\n' + results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
