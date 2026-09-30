/**
 * Renders the generated icons through Android's real mask shapes and launches
 * them in the browser, so the maskable icons are verified rather than assumed.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const OUT = '/Users/rajputnaresh/projects/khata/shots/icon-preview.html'

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin:0; font:14px/1.4 -apple-system,system-ui,sans-serif; background:#f2f2f4; padding:28px; color:#111; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:#666; margin:0 0 12px; }
  .row { display:flex; gap:28px; align-items:flex-end; margin-bottom:34px; flex-wrap:wrap; }
  figure { margin:0; text-align:center; }
  figcaption { font-size:11px; color:#666; margin-top:8px; }
  /* Android launcher masks */
  .circle { border-radius:50%; overflow:hidden; }
  .squircle { border-radius:28%; overflow:hidden; }
  .rounded { border-radius:22%; overflow:hidden; }
  .full { border-radius:0; overflow:hidden; }
  img { display:block; }
</style></head><body>
  <h2>maskable-512.png through Android launcher masks</h2>
  <div class="row">
    <figure><img class="circle"   src="../public/icons/maskable-512.png" width="128" height="128"><figcaption>circle</figcaption></figure>
    <figure><img class="squircle" src="../public/icons/maskable-512.png" width="128" height="128"><figcaption>squircle</figcaption></figure>
    <figure><img class="rounded"  src="../public/icons/maskable-512.png" width="128" height="128"><figcaption>rounded square</figcaption></figure>
    <figure><img class="full"     src="../public/icons/maskable-512.png" width="128" height="128"><figcaption>unmasked</figcaption></figure>
  </div>
  <h2>icon-512.png (any) at real sizes</h2>
  <div class="row">
    <figure><img src="../public/icons/icon-512.png" width="192" height="192"><figcaption>192</figcaption></figure>
    <figure><img src="../public/icons/icon-192.png" width="96" height="96"><figcaption>192 @96</figcaption></figure>
    <figure><img src="../public/icons/icon-192.png" width="64" height="64"><figcaption>192 @64</figcaption></figure>
    <figure><img src="../public/icons/icon-192.png" width="40" height="40"><figcaption>192 @40 (tiny)</figcaption></figure>
  </div>
  <h2>legibility check &mdash; favicon at 16px</h2>
  <div class="row">
    <figure><img src="../public/favicon.svg" width="16" height="16"><figcaption>16px</figcaption></figure>
    <figure><img src="../public/favicon.svg" width="32" height="32"><figcaption>32px</figcaption></figure>
    <figure><img src="../public/favicon.svg" width="64" height="64"><figcaption>64px</figcaption></figure>
  </div>
</body></html>`

writeFileSync(OUT, html, 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 780 } })
await page.goto(`file://${OUT}`)
await page.waitForTimeout(1200)
await page.screenshot({ path: '/Users/rajputnaresh/projects/khata/shots/icon-preview.png', fullPage: true })
console.log('wrote shots/icon-preview.png')
await browser.close()
