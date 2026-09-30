import { useEffect, useState } from 'react'
import {
  BarChart3, Cloud, LayoutDashboard, List, Plus, Settings as SettingsIcon, Wallet,
} from 'lucide-react'
import { Dashboard } from './views/dashboard'
import { Transactions } from './views/transactions'
import { InsightsView } from './views/insights'
import { BackupView } from './views/backup'
import { TxEditor } from './components/tx-editor'
import { Sheet, ToastHost, haptic, useToast } from './components/ui'
import { useCategories, useSettings, useTheme, updateSettings } from './lib/store'
import { ensureSeed } from './lib/db'
import { CURRENCIES, money, parseAmount, symbolFor } from './lib/util'
import type { Tx, TxType } from './lib/types'

type Tab = 'home' | 'tx' | 'insights' | 'backup' | 'settings'

const TABS: { id: Tab; label: string; icon: typeof Wallet }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'tx', label: 'Activity', icon: List },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'backup', label: 'Backup', icon: Cloud },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

function App() {
  const { push } = useToast()
  const [tab, setTab] = useState<Tab>('home')
  const [ready, setReady] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorType, setEditorType] = useState<TxType>('expense')
  const [editing, setEditing] = useState<Tx | null>(null)
  const [txFilterCat, setTxFilterCat] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const { categories } = useCategories()
  const settings = useSettings()
  useTheme()

  useEffect(() => {
    ensureSeed()
      .then(() => setReady(true))
      .catch((e) => {
        setReady(true)
        push({ msg: `Storage error: ${e}`, tone: 'err' })
      })
  }, [push])

  // App shortcuts from the home-screen icon.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const action = p.get('action')
    if (action === 'expense' || action === 'income') {
      setEditorType(action)
      setEditing(null)
      setEditorOpen(true)
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const openAdd = (type: TxType) => {
    setEditorType(type)
    setEditing(null)
    setAddOpen(false)
    setEditorOpen(true)
    haptic(8)
  }

  const openTx = (t: Tx) => {
    setEditing(t)
    setEditorType(t.type)
    setEditorOpen(true)
  }

  const jumpToCategory = (id: string) => {
    setTxFilterCat(id)
    setTab('tx')
  }

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-10 w-10 animate-pulse rounded-2xl"
            style={{ background: 'var(--color-saffron)' }}
          />
          <span className="text-[12px] font-semibold text-[var(--fg-subtle)]">Opening Khata…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      {/* top bar */}
      <header className="safe-t sticky top-0 z-30 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] backdrop-blur-xl">
        <div className="safe-x mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: 'var(--color-saffron)' }}
            >
              <Wallet size={15} color="#fff" strokeWidth={2.5} />
            </div>
            <span className="text-[15px] font-extrabold tracking-tight">Khata</span>
          </div>
          <button
            onClick={() => {
              setEditing(null)
              setEditorType('expense')
              setEditorOpen(true)
            }}
            className="btn btn-primary min-h-11 px-4 py-2 text-[13px]"
          >
            <Plus size={16} strokeWidth={2.8} />
            Add
          </button>
        </div>
      </header>

      <main className="safe-x mx-auto max-w-3xl px-4 pb-nav pt-4">
        {tab === 'home' && (
          <Dashboard
            onOpenAdd={openAdd}
            onOpenTx={openTx}
            onOpenInsights={() => setTab('insights')}
            onJumpMonth={() => setTab('tx')}
          />
        )}
        {tab === 'tx' && (
          <Transactions
            onOpen={openTx}
            filterCategory={txFilterCat}
            onClearCategory={() => setTxFilterCat(null)}
          />
        )}
        {tab === 'insights' && <InsightsView onJumpCategory={jumpToCategory} />}
        {tab === 'backup' && <BackupView />}
        {tab === 'settings' && (
          <SettingsPanel onNavigate={(t) => setTab(t)} />
        )}
      </main>

      {/* bottom nav */}
      <nav className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] backdrop-blur-xl">
        <div className="safe-x mx-auto flex max-w-3xl items-stretch px-2">
          {TABS.map((t) => {
            const on = tab === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors"
                style={{ color: on ? 'var(--color-saffron)' : 'var(--fg-subtle)' }}
                aria-current={on ? 'page' : undefined}
              >
                {on && (
                  <span
                    className="absolute top-0 h-0.5 w-8 rounded-full"
                    style={{ background: 'var(--color-saffron)' }}
                  />
                )}
                <Icon size={19} strokeWidth={on ? 2.5 : 2} />
                <span className="text-[9.5px] font-bold tracking-tight">{t.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* FAB (mobile only) */}
      <button
        onClick={() => setAddOpen(true)}
        className="safe-b fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-2xl shadow-[var(--shadow-pop)] transition-transform active:scale-90 sm:hidden"
        style={{ background: 'var(--color-saffron)' }}
        aria-label="Add transaction"
      >
        <Plus size={26} color="#fff" strokeWidth={2.6} />
      </button>

      {/* add sheet: choose type first */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add to Khata">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => openAdd('expense')}
            className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] py-7 transition-transform active:scale-95"
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-white"
              style={{ background: 'var(--color-saffron)' }}
            >
              <Wallet size={22} />
            </span>
            <span className="text-[13.5px] font-bold">Expense</span>
            <span className="text-[11px] text-[var(--fg-subtle)]">Money out</span>
          </button>
          <button
            onClick={() => openAdd('income')}
            className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] py-7 transition-transform active:scale-95"
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-white"
              style={{ background: 'var(--color-mint)' }}
            >
              <BarChart3 size={22} />
            </span>
            <span className="text-[13.5px] font-bold">Income</span>
            <span className="text-[11px] text-[var(--fg-subtle)]">Money in</span>
          </button>
        </div>
      </Sheet>

      <TxEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        categories={categories}
        editing={editing}
        initialType={editorType}
        currency={settings.currency}
      />
    </div>
  )
}

/* ---------------- settings ---------------- */

function SettingsPanel({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const { categories } = useCategories()
  const settings = useSettings()
  const { mode, pref } = useTheme()
  const { push } = useToast()
  const [budgetDraft, setBudgetDraft] = useState(() =>
    settings.overallMonthlyLimit > 0 ? (settings.overallMonthlyLimit / 100).toFixed(0) : '',
  )
  const [showCats, setShowCats] = useState(false)

  const saveBudget = async () => {
    const paise = budgetDraft ? parseAmount(budgetDraft) : 0
    await updateSettings({ overallMonthlyLimit: paise ?? 0 })
    push({ msg: paise ? `Monthly budget set to ${money(paise, settings.currency, 0)}` : 'Budget cleared', tone: 'ok' })
  }

  return (
    <div className="space-y-4">
      {/* budget */}
      <section className="card p-4">
        <div className="mb-1 text-[13.5px] font-bold">Monthly spending budget</div>
        <p className="mb-3 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          Powers the safe-to-spend figure, the burn-rate ring and the runway insight.
        </p>
        <div className="flex gap-2">
          <input
            className="field tnum"
            inputMode="decimal"
            value={budgetDraft}
            onChange={(e) => setBudgetDraft(e.target.value)}
            placeholder="e.g. 30000"
          />
          <button className="btn btn-primary px-4" onClick={saveBudget}>
            Save
          </button>
        </div>
      </section>

      {/* currency */}
      <section className="card p-4">
        <div className="mb-3 text-[13.5px] font-bold">Currency</div>
        <div className="flex flex-wrap gap-1.5">
          {CURRENCIES.map((c) => {
            const on = settings.currency === c
            return (
              <button
                key={c}
                onClick={async () => {
                  await updateSettings({ currency: c })
                  push({ msg: `Currency set to ${c}`, tone: 'ok' })
                }}
                className="chip transition-colors"
                style={{
                  background: on ? 'var(--color-saffron)' : 'var(--surface-3)',
                  color: on ? '#fff' : 'var(--fg-muted)',
                  borderColor: on ? 'transparent' : 'var(--line)',
                }}
              >
                {symbolFor(c)}
                {c}
              </button>
            )
          })}
        </div>
      </section>

      {/* appearance */}
      <section className="card p-4">
        <div className="mb-3 text-[13.5px] font-bold">Appearance</div>
        <div className="grid grid-cols-3 gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => {
            const on = pref === t
            return (
              <button
                key={t}
                onClick={async () => {
                  await updateSettings({ theme: t })
                }}
                className="rounded-xl border py-2.5 text-[12.5px] font-bold capitalize transition-all"
                style={{
                  borderColor: on ? 'var(--color-saffron)' : 'var(--line)',
                  background: on ? 'color-mix(in oklab, var(--color-saffron) 12%, transparent)' : 'var(--surface-3)',
                  color: on ? 'var(--color-saffron)' : 'var(--fg-muted)',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
        <div className="mt-2 text-[11px] text-[var(--fg-subtle)]">Currently showing: {mode} mode</div>
      </section>

      {/* categories */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13.5px] font-bold">Categories</div>
          <button
            onClick={() => setShowCats((v) => !v)}
            className="text-[11.5px] font-bold text-[var(--color-saffron)]"
          >
            {showCats ? 'Hide' : `Show all (${categories.length})`}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories
            .filter((c) => (showCats ? true : !c.archived))
            .map((c) => (
              <span
                key={c.id}
                className="chip"
                style={{
                  background: `color-mix(in oklab, ${c.color} 13%, transparent)`,
                  color: c.color,
                  borderColor: 'transparent',
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                {c.name}
              </span>
            ))}
        </div>
      </section>

      {/* backup shortcut */}
      <section className="card p-4">
        <div className="mb-1 text-[13.5px] font-bold">Backups & data</div>
        <p className="mb-3 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          Connect Google Drive, restore a snapshot, or export/import CSV.
        </p>
        <button className="btn btn-outline w-full" onClick={() => onNavigate('backup')}>
          <Cloud size={15} /> Open backup & data
        </button>
      </section>

      {/* about */}
      <section className="card p-4">
        <div className="mb-2 text-[13.5px] font-bold">About Khata</div>
        <ul className="space-y-1.5 text-[12px] leading-relaxed text-[var(--fg-muted)]">
          <li>· All data lives on this device (IndexedDB). No server, no account.</li>
          <li>· Works fully offline; install it to your home screen.</li>
          <li>· Backups are AES-256-GCM encrypted before upload to Drive.</li>
        </ul>
        <div className="mt-3 text-[11px] text-[var(--fg-subtle)]">v1.0.0 · local-first budget tracker</div>
      </section>
    </div>
  )
}

export default function Root() {
  return (
    <ToastHost>
      <App />
    </ToastHost>
  )
}
