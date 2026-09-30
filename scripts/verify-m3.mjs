/**
 * Verifies the generated M3 palette inside the real browser build:
 * correct roles, and WCAG-AA contrast for every foreground/background pair
 * the UI actually uses.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const out = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement)
  const get = (n) => cs.getPropertyValue(n).trim()

  // Read the M3 roles off :root and compute WCAG contrast.
  const toRgb = (hex) => {
    const h = hex.replace('#', '')
    const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
  }
  const lum = (hex) => {
    const [r, g, b] = toRgb(hex).map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
  }

  const roles = {}
  for (const n of ['primary', 'on-primary', 'primary-container', 'on-primary-container',
    'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
    'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
    'error', 'on-error', 'error-container', 'on-error-container',
    'background', 'on-background', 'surface', 'on-surface', 'surface-variant', 'on-surface-variant',
    'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high',
    'surface-container-highest', 'outline', 'outline-variant',
    'inverse-surface', 'inverse-on-surface', 'inverse-primary', 'scrim', 'shadow']) {
    const v = get(`--md-sys-color-${n}`)
    if (v) roles[n] = v
  }

  const pairs = [
    ['on-surface', 'surface', 4.5],
    ['on-surface-variant', 'surface', 4.5],
    ['on-primary', 'primary', 4.5],
    ['on-primary-container', 'primary-container', 4.5],
    ['on-secondary-container', 'secondary-container', 4.5],
    ['on-tertiary-container', 'tertiary-container', 4.5],
    ['on-error', 'error', 4.5],
    ['on-error-container', 'error-container', 4.5],
    ['on-surface', 'surface-container', 4.5],
    ['on-surface', 'surface-container-high', 4.5],
    ['primary', 'surface', 3],
    ['error', 'surface', 3],
    ['outline', 'surface', 3],
  ]

  const contrast = pairs.map(([fg, bg, min]) => {
    const f = roles[fg]
    const b = roles[bg]
    if (!f || !b) return { fg, bg, skip: true }
    const r = ratio(f, b)
    return { fg, bg, ratio: Math.round(r * 100) / 100, min, pass: r >= min }
  })

  return { roles, contrast, hasScheme: !!roles.primary }
})

console.log('M3 roles generated:', Object.keys(out.roles).length)
console.log(JSON.stringify(out.roles, null, 0).slice(0, 700))
console.log('\nWCAG contrast:')
let bad = 0
for (const c of out.contrast) {
  if (c.skip) { console.log(`  SKIP ${c.fg} on ${c.bg}`); continue }
  if (!c.pass) bad++
  console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.ratio.toString().padStart(6)}:1  (min ${c.min})  ${c.fg} on ${c.bg}`)
}
console.log(`\n${out.contrast.filter((c) => !c.skip).length - bad} ok, ${bad} failing`)
await browser.close()
process.exit(bad > 0 ? 1 : 0)
