# Khata — personal budget tracker

An offline-first budget app you install to your phone's home screen. Your data
lives on the device, insights are computed locally, and backups are
**AES-256-GCM encrypted** before they touch Google Drive.

No account, no server, no monthly cost.

---

## Why a PWA and not a native app

| Requirement | What Khata does |
|---|---|
| Install on my phone | Home-screen icon, launches fullscreen, works offline |
| Unlimited backup on GDrive | Rotating encrypted snapshots in Drive's hidden `appDataFolder` |
| Personal use, low cost | Zero hosting, zero subscriptions |
| Privacy | Data never leaves the device; only you can decrypt a backup |

---

## Features

**Dashboard**
- Month switcher with hero total, income vs. net-saved split
- Budget ring with a straight-line projection to month end
- 12-month spending trend (tap a point for the month total)
- Category donut + ranked bars
- Insight cards, newest and most actionable first

**Insights** (all computed on-device)
- Daily-rhythm buckets across the month
- Category breakdown with share and count
- Savings rate against the 20% benchmark
- Burn rate, safe-to-spend, and runway
- Month-over-month delta vs. the previous month
- Anomaly detection: any entry > 2.5x its category average
- Heavy-weekday detection, logging streaks, merchant rollups

**Activity**
- Day-grouped ledger with search, type filter, and sort
- Inline edit and delete, with undo on every destructive action

**Backup & data**
- One-tap encrypted snapshot to Google Drive
- Restore any snapshot (full state replacement)
- CSV export/import for moving data anywhere
- Erase-all-locally

**Settings**
- Monthly budget target, currency (12 currencies), light/dark/system theme

### Trustworthy insights, not noise
A single ₹450 entry does not earn you a "trend". Insights that depend on
statistical confidence (month-over-month, heavy weekday, anomalies, category
share) stay silent until there is enough volume behind them. The app tells you
how many more entries it needs instead of inventing a conclusion.

---

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build and local preview:

```bash
npm run build
npm run preview    # http://localhost:4173
```

### Tests

```bash
npm test              # crypto unit tests (round-trip, tamper, wrong passphrase)
npm run test:e2e      # core flows: add, persist, tabs, crypto, service worker
npm run test:insights # insight gating with thin vs. realistic data
npm run test:offline  # boots and writes with the network fully off
npm run test:layout   # no overlap, tap-target sizes, scroll clearance
npm run test:live    # the deployed HTTPS URL: installability + offline
```

The e2e scripts drive the real production build in headless Chromium, so run
`npm run preview` first (or in another terminal).

---

### Live deployment
<https://rajputnaresh.github.io/khata/> — deployed from `main` by
`.github/workflows/deploy.yml` on every push.

---

## Installing on your phone

The app must be served over **HTTPS** (or localhost) for service workers,
installability and the Web Crypto API to work.

1. Deploy `dist/` to any static host — GitHub Pages, Cloudflare Pages, Netlify,
   Vercel, or Render. All have free tiers.
2. Open the URL on your phone.
3. **Android (Chrome):** menu → *Install app* / *Add to Home screen*.
   **iOS (Safari):** Share → *Add to Home Screen*.

It then launches like a native app: no browser chrome, its own icon, offline.

---

## Google Drive backups (one-time setup)

Drive access needs a Google OAuth **client ID**. This is a free, ~3-minute setup
and it is a one-off — you paste the ID once and Khata remembers it.

1. Go to <https://console.cloud.google.com/projectcreate> and create a project
   (any name).
2. Enable the API: *APIs & Services* → *Library* → search **Google Drive API**
   → **Enable**.
3. Configure the consent screen: *APIs & Services* → *OAuth consent screen* →
   choose **External** → fill in app name and your email → add your email as a
   **Test user**.
4. Create credentials: *APIs & Services* → *Credentials* → *Create credentials*
   → **OAuth client ID** → type **Web application**.
5. Under *Authorized JavaScript origins* add your deployed URL, e.g.
   `https://your-app.pages.dev`.
   Under *Authorized redirect URIs* add the same URL **plus the exact path of
   your app**, e.g. `https://your-app.pages.dev/` (Khata uses the current page
   URL as the redirect).
6. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
7. In Khata: **Backup** tab → paste the Client ID → *Connect Google Drive* →
   choose your Google account → *Allow*.

From then on, enter a passphrase (6+ chars) and tap **Back up now**.

### How the encryption works

```
passphrase ──PBKDF2-SHA256(600k iters)──> AES-256-GCM key
snapshot JSON ──AES-256-GCM──> ciphertext (salt + IV stored in the file)
```

- Your passphrase **never leaves the device** and is **not** stored with the
  backup. If you lose it, the backup is unrecoverable — that is the point.
- Google Drive only ever sees ciphertext.
- A wrong passphrase or a tampered file fails the GCM authentication tag and is
  rejected, never silently accepted.
- Backups live in Drive's `appDataFolder`, which is invisible in "My Drive" and
  does not clutter your files. The newest 30 snapshots are kept; older ones
  rotate out automatically, so storage stays tiny.

> **Localhost note:** Drive's implicit OAuth flow does not accept
> `http://localhost` as an authorized origin in all cases. If connecting from
> `localhost` fails, deploy to an HTTPS URL and connect from there.

---

## Data & privacy

- All transactions, categories and settings live in **IndexedDB** on the device.
- Nothing is transmitted except when you explicitly tap *Back up now*.
- Insights are computed locally; no analytics, no third-party services.
- *Erase all local data* wipes the device but leaves Drive snapshots intact
  (so you can still restore).

---

## Project layout

```
src/
  lib/
    db.ts        Dexie/IndexedDB schema + seed categories
    types.ts     Domain types (amounts stored as integer paise)
    util.ts      Dates, money formatting, rollups
    crypto.ts    PBKDF2 + AES-GCM backup envelope
    gdrive.ts    Google Drive transport (appDataFolder, token refresh)
    insights.ts  The insight engine
    store.ts     React hooks + mutations + CSV import/export
  components/
    charts.tsx   Donut, area trend, bar chart, budget ring (hand-rolled SVG)
    ui.tsx       Toast, sheet, segmented control, empty state
    tx-editor.tsx  Add/edit transaction sheet
  views/
    dashboard.tsx  transactions.tsx  insights.tsx  backup.tsx
  App.tsx        Shell, tabs, routing
  main.tsx       Entry + service-worker registration
scripts/         Icon generation + e2e suites
tests/           Crypto unit tests
```

Amounts are stored as **integer paise** (1 rupee = 100) so arithmetic never
hits floating-point drift; formatting to `₹1,234.56` happens only at render.

---

## Tech

Vite · React 19 · TypeScript · Tailwind CSS v4 · Dexie (IndexedDB) ·
vite-plugin-pwa / Workbox · Web Crypto · lucide-react · Google Drive API v3 ·
`@material/material-color-utilities` (build-time only).

No chart library — the charts are hand-rolled SVG, so there is no heavy
dependency and the bundle stays small.

---

## Material Design 3

The UI is built on the M3 design system, not a hand-picked palette.

`src/lib/m3.ts` derives **34 canonical `--md-sys-color-*` roles** (light and
dark) from a single seed colour using Google's own HCT colour engine, plus the
M3 type scale, corner scale, motion easings and elevation levels. The result is
committed to `src/styles/m3.generated.css`, so a normal build never needs the
colour engine and the browser gets plain CSS variables with zero runtime cost.

```bash
npm run theme      # regenerate the M3 tokens after changing the seed
npm run fonts      # re-download the self-hosted Roboto subsets
npm run verify:m3  # assert WCAG contrast for every role pair
```

**Brand pinning.** Material's stock `SchemeTonalSpot` deliberately desaturates a
seed; run against the saffron seed it drifted to a dusty rose, losing the brand.
`src/lib/brand-scheme.ts` subclasses it and pins only the primary family to the
seed's own hue, keeping the seed's chroma. Every other role still comes from
Google's generated scheme, so the palette stays coherent. (`SchemeTonalSpot`'s
roles are prototype getters, so they have to be overridden — assigning to them
silently does nothing.)

**Contrast is verified, not assumed.** `verify:m3` checks 13 foreground /
background pairs the UI actually uses. All pass AA, worst case 4.28:1 against a
3:1 requirement.

Roboto is self-hosted as woff2 (latin + latin-ext, 112 KB) rather than loaded
from Google Fonts, so the app keeps working with no network and makes no
third-party requests.
