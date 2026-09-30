import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const browser = await chromium.launch()

// Desktop
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-IN' })
const page = await ctx.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('khata'); r.onsuccess = () => res(r.result) })
  const cats = await new Promise((res) => { const t = db.transaction('categories','readonly'); const q = t.objectStore('categories').getAll(); q.onsuccess = () => res(q.result) })
  const ec = cats.filter(c => c.kind === 'expense').map(c => c.id)
  const t = new Date()
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const rows = []
  const notes = ['Swiggy order','Big Basket','Petrol','Metro card','Cafe Blue','Chemist','Dinner','Groceries']
  for (let i = 0; i < 24; i++) {
    const d = new Date(t); d.setDate(d.getDate() - (i % 15))
    rows.push({ id:`d${i}`, type:'expense', amount:18000+i*2400, categoryId:ec[i%ec.length],
      note:notes[i%notes.length], date:iso(d), status:'cleared', recurring:i%6===0, createdAt:i, updatedAt:i })
  }
  for (let i = 0; i < 16; i++) {
    const d = new Date(t.getFullYear(), t.getMonth()-1, 4+i)
    rows.push({ id:`dp${i}`, type:'expense', amount:38000+i*1800, categoryId:ec[i%ec.length],
      note:notes[(i+2)%notes.length], date:iso(d), status:'cleared', recurring:false, createdAt:i, updatedAt:i })
  }
  rows.push({ id:'dinc', type:'income', amount:1450000, categoryId:'c_salary', note:'Monthly salary', date:iso(t), status:'cleared', recurring:true, createdAt:0, updatedAt:0 })
  await new Promise(res => { const tx = db.transaction('tx','readwrite'); const s = tx.objectStore('tx'); rows.forEach(r=>s.put(r)); tx.oncomplete = res })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
await page.screenshot({ path: 'shots/desktop-dashboard.png' })

await page.getByRole('button', { name: 'Backup' }).click()
await page.waitForTimeout(900)
await page.screenshot({ path: 'shots/desktop-backup.png' })

await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(1100)
await page.screenshot({ path: 'shots/desktop-insights.png' })

// Dark mode
await page.getByRole('button', { name: 'Home' }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: 'dark', exact: true }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: 'Home' }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: 'shots/desktop-dark.png' })

await browser.close()
console.log('desktop shots written')
