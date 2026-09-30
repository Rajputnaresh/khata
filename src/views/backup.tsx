import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle, Cloud, CloudOff, Download, FolderLock, HardDriveDownload,
  KeyRound, Link2, Lock, RefreshCw, ShieldCheck, Trash2, Upload, WifiOff,
} from 'lucide-react'
import { Confirm, Sheet, useToast } from '../components/ui'
import { decryptEnvelope, encryptSnapshot, passphraseStrength, type BackupEnvelope, type Snapshot } from '../lib/crypto'
import { db } from '../lib/db'
import * as gd from '../lib/gdrive'
import { clearAllData, importCsv, toCsv, useSettings, updateSettings } from '../lib/store'
import { today } from '../lib/util'

const PASSPHRASE_KEY = 'khata.backup.passphrase'
const KEEP = 30

type Phase = 'disconnected' | 'connecting' | 'connected' | 'working' | 'error'

export function BackupView() {
  const { push } = useToast()
  const settings = useSettings()

  const [phase, setPhase] = useState<Phase>('disconnected')
  const [connected, setConnected] = useState(false)
  const [clientId, setClientId] = useState(gd.getClientId() ?? '')
  const [passphrase, setPassphrase] = useState(() => {
    try {
      return sessionStorage.getItem(PASSPHRASE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [showPass, setShowPass] = useState(false)
  const [backups, setBackups] = useState<gd.DriveFile[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [quotaInfo, setQuotaInfo] = useState<string | null>(null)

  /* ---------- mount: restore a live OAuth callback if present ---------- */
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('access_token')) return
    const parsed = gd.parseAuthFragment(hash)
    history.replaceState(null, '', window.location.pathname + window.location.search)
    if (!parsed) {
      setErr('Could not read the Google response. Try connecting again.')
      return
    }
    const id = gd.getClientId()
    if (!id) {
      setErr('Client ID was lost. Re-enter it and connect again.')
      return
    }
    void (async () => {
      try {
        await db.meta.put({
          key: gd.TOKEN_KEY,
          value: {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken ?? '',
            expiresAt: Date.now() + 45 * 60_000,
            clientId: id,
          },
        })
        setConnected(true)
        setPhase('connected')
        push({ msg: 'Google Drive connected', tone: 'ok' })
      } catch (e) {
        setErr(String(e))
      }
    })()
  }, [push])

  /* ---------- hydrate connection state ---------- */
  const refresh = useCallback(async () => {
    const ok = await gd.isConnected()
    setConnected(ok)
    setPhase(ok ? 'connected' : 'disconnected')
    if (!ok) return
    try {
      const files = await gd.listBackups()
      setBackups(files)
      const q = await gd.quota()
      if (q) {
        const usedGB = (q.used / 1e9).toFixed(2)
        const limitGB = (q.limit / 1e9).toFixed(0)
        setQuotaInfo(`${usedGB} GB of ${limitGB} GB Drive used`)
      }
    } catch (e) {
      setErr(e instanceof gd.DriveError ? e.message : 'Could not read Drive. Reconnect to continue.')
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const strength = passphraseStrength(passphrase)
  const canBackup = connected && passphrase.length >= 6

  const rememberPass = (p: string) => {
    setPassphrase(p)
    try {
      if (p) sessionStorage.setItem(PASSPHRASE_KEY, p)
      else sessionStorage.removeItem(PASSPHRASE_KEY)
    } catch {
      /* ignore */
    }
  }

  const connect = async () => {
    setErr(null)
    if (!clientId.trim()) {
      setErr('Enter your Google OAuth Client ID first.')
      return
    }
    try {
      await gd.saveClientId(clientId)
      setPhase('connecting')
      window.location.href = gd.authUrl(clientId.trim(), window.location.origin + window.location.pathname)
    } catch (e) {
      setErr(String(e))
      setPhase('error')
    }
  }

  /** Build a snapshot from live IndexedDB and encrypt it. */
  const makeSnapshot = async (): Promise<Snapshot> => {
    const [tx, categories, s] = await Promise.all([
      db.tx.toArray(),
      db.categories.toArray(),
      db.settings.get('app'),
    ])
    return {
      app: 'khata',
      version: 1,
      createdAt: Date.now(),
      device: navigator.userAgent.slice(0, 120),
      settings: s ?? null,
      categories,
      tx,
    }
  }

  const doBackup = async () => {
    if (!canBackup) return
    setBusy('backup')
    setErr(null)
    try {
      const snap = await makeSnapshot()
      const env = await encryptSnapshot(snap, passphrase)
      const name = gd.backupNameFor(today())
      const report = await gd.runBackup({
        envelope: JSON.stringify(env),
        txCount: snap.tx.length,
        name,
        keep: KEEP,
      })
      await updateSettings({ lastBackupAt: report.at, lastBackupName: report.name })
      setBackups(await gd.listBackups())
      hapticOk()
      push({
        msg: `Backed up ${report.txCount} entries (${formatBytes(report.size)})`,
        tone: 'ok',
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Backup failed')
      push({ msg: 'Backup failed', tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  const doRestore = async (fileId: string) => {
    if (!canBackup) return
    setRestoreOpen(false)
    setBusy('restore')
    setErr(null)
    try {
      const raw = await gd.download(fileId)
      const env = JSON.parse(raw) as BackupEnvelope
      const snap = await decryptEnvelope(env, passphrase)
      // Replace wholesale — a restore is a full state replacement, not a merge.
      await db.transaction('rw', db.tx, db.categories, db.settings, async () => {
        await db.tx.clear()
        await db.categories.clear()
        if (snap.categories.length) {
          await db.categories.bulkPut(snap.categories as never)
        }
        if (snap.settings) await db.settings.put(snap.settings as never)
        await db.tx.bulkPut(snap.tx as never)
      })
      await updateSettings({ lastBackupAt: env.t })
      push({ msg: `Restored ${snap.tx.length} entries from backup`, tone: 'ok' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Restore failed')
      push({ msg: e instanceof Error ? e.message : 'Restore failed', tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  const deleteBackup = async (id: string) => {
    setBusy('delete')
    try {
      await gd.trash(id)
      setBackups(await gd.listBackups())
      push({ msg: 'Backup removed from Drive', tone: 'info' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    await gd.disconnect()
    setConnected(false)
    setBackups([])
    setPhase('disconnected')
    push({ msg: 'Drive disconnected', tone: 'info' })
  }

  /* ---------- local export / import (no cloud needed) ---------- */

  const exportCsv = async () => {
    const [tx, cats] = await Promise.all([db.tx.toArray(), db.categories.toArray()])
    const byId = new Map(cats.map((c) => [c.id, c.name]))
    const csv = toCsv(
      tx
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => ({
          date: t.date,
          type: t.type,
          category: byId.get(t.categoryId) ?? 'Other',
          note: t.note,
          amount: t.amount,
          recurring: t.recurring,
        })),
    )
    downloadBlob(csv, `khata-export-${today()}.csv`, 'text/csv')
    push({ msg: `Exported ${tx.length} rows to CSV`, tone: 'ok' })
  }

  const importCsvFile = async (file: File) => {
    setBusy('import')
    try {
      const text = await file.text()
      const cats = await db.categories.toArray()
      const n = await importCsv(text, cats)
      push({ msg: n > 0 ? `Imported ${n} entries` : 'No valid rows found in that file', tone: n > 0 ? 'ok' : 'err' })
    } finally {
      setBusy(null)
    }
  }

  const lastBackup = settings.lastBackupAt
    ? new Date(settings.lastBackupAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <div className="space-y-4">
      {/* status hero */}
      <section className="card p-5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: connected ? 'color-mix(in oklab, var(--tone-good) 15%, transparent)' : 'var(--md-sys-color-surface-container-highest)',
              color: connected ? 'var(--tone-good)' : 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            {connected ? <Cloud size={21} /> : <CloudOff size={21} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold tracking-tight">
              {connected ? 'Google Drive connected' : 'Backups are off'}
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
              {connected
                ? `Encrypted snapshots go to a hidden Drive folder${lastBackup ? ` · last one ${lastBackup}` : ''}.`
                : 'Connect Drive to keep unlimited encrypted snapshots of your data.'}
            </div>
            {quotaInfo && connected && (
              <div className="mt-1.5 text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">{quotaInfo}</div>
            )}
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-bold">
          <ShieldCheck size={15} style={{ color: 'var(--tone-good)' }} />
          How your backup stays private
        </div>
        <ul className="space-y-2 text-[12px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
          <li className="flex gap-2">
            <Lock size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--md-sys-color-primary)' }} />
            Your passphrase never leaves this device and is not stored with the backup.
          </li>
          <li className="flex gap-2">
            <Lock size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--md-sys-color-primary)' }} />
            Data is encrypted with AES-256-GCM before it touches the network.
          </li>
          <li className="flex gap-2">
            <FolderLock size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--md-sys-color-primary)' }} />
            Backups land in Drive's appDataFolder — invisible in "My Drive", so it never clutters your files.
          </li>
          <li className="flex gap-2">
            <RefreshCw size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--md-sys-color-primary)' }} />
            The newest {KEEP} snapshots are kept; older ones are rotated out automatically.
          </li>
        </ul>
      </section>

      {/* connect flow */}
      {!connected && (
        <section className="card space-y-3 p-4">
          <div className="text-[13.5px] font-bold">One-time setup</div>
          <p className="text-[12px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
            Khata needs a Google OAuth <em>client ID</em> to use Drive. Create a free project in Google
            Cloud, enable the Drive API, then paste the client ID below. Full steps are in the README.
          </p>
          <input
            className="field font-mono text-[12px]"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="1234567890-abc.apps.googleusercontent.com"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" onClick={connect} disabled={!clientId.trim() || phase === 'connecting'}>
              <Link2 size={15} />
              {phase === 'connecting' ? 'Redirecting…' : 'Connect Google Drive'}
            </button>
          </div>
          {err && <ErrorNote msg={err} />}
        </section>
      )}

      {/* connected controls */}
      {connected && (
        <>
          <section className="card space-y-3 p-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="label" htmlFor="pp">
                  Backup passphrase
                </label>
                <button
                  onClick={() => setShowPass((v) => !v)}
                  className="text-[11px] font-bold text-[var(--md-sys-color-primary)]"
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="relative">
                <input
                  id="pp"
                  type={showPass ? 'text' : 'password'}
                  className="field pr-10"
                  value={passphrase}
                  onChange={(e) => rememberPass(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                />
                <KeyRound
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)]"
                />
              </div>
              {passphrase.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full transition-colors"
                        style={{
                          background:
                            i < strength.score
                              ? ['var(--tone-bad)', 'var(--tone-warn)', 'var(--tone-warn)', 'var(--tone-good)', 'var(--tone-good)'][
                                  strength.score
                                ]
                              : 'var(--md-sys-color-outline-variant)',
                        }}
                      />
                    ))}
                  </div>
                  <div className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                    Strength: <span className="font-semibold">{strength.label}</span> — you need this exact
                    passphrase to restore.
                  </div>
                </div>
              )}
            </div>

            <button className="btn btn-primary w-full py-3" onClick={doBackup} disabled={!canBackup || busy !== null}>
              {busy === 'backup' ? (
                <>
                  <RefreshCw size={15} className="animate-spin" /> Encrypting & uploading…
                </>
              ) : (
                <>
                  <Upload size={15} /> Back up now
                </>
              )}
            </button>
            {!canBackup && (
              <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                Enter a passphrase of at least 6 characters to enable backups.
              </p>
            )}
            {err && <ErrorNote msg={err} />}
          </section>

          {/* backup list */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13.5px] font-bold">Snapshots ({backups.length})</div>
              <button onClick={refresh} className="text-[11.5px] font-bold text-[var(--md-sys-color-primary)]">
                Refresh
              </button>
            </div>
            {backups.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-[var(--md-sys-color-on-surface-variant)]">
                No snapshots yet. Tap "Back up now" to create your first.
              </p>
            ) : (
              <div className="space-y-1.5">
                {backups.map((b) => {
                  const d = new Date(b.modifiedTime)
                  return (
                    <div key={b.id} className="flex items-center gap-2.5 rounded-xl bg-[var(--md-sys-color-surface-container-highest)] px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-semibold">{b.name}</div>
                        <div className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                          {d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                          {formatBytes(Number(b.size) || 0)}
                        </div>
                      </div>
                      <button
                        onClick={() => doRestore(b.id)}
                        disabled={!canBackup || busy !== null}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--md-sys-color-surface)] disabled:opacity-40"
                        aria-label={`Restore ${b.name}`}
                        title="Restore this snapshot"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => deleteBackup(b.id)}
                        disabled={busy !== null}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--md-sys-color-surface)] disabled:opacity-40"
                        aria-label={`Delete ${b.name}`}
                        title="Delete this snapshot"
                      >
                        <Trash2 size={14} style={{ color: 'var(--tone-bad)' }} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <button className="btn btn-tonal mt-3 w-full" onClick={disconnect}>
              Disconnect Drive
            </button>
          </section>
        </>
      )}

      {/* local export/import — always available */}
      <section className="card p-4">
        <div className="mb-1 text-[13.5px] font-bold">Move data in and out</div>
        <p className="mb-3 text-[12px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
          CSV is plain text — open it in any spreadsheet, or use it to load history from another app.
        </p>
        <div className="flex gap-2">
          <button className="btn btn-outline flex-1" onClick={exportCsv} disabled={busy !== null}>
            <HardDriveDownload size={15} /> Export CSV
          </button>
          <label className="btn btn-outline flex-1 cursor-pointer disabled:opacity-40">
            <Download size={15} /> Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importCsvFile(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </section>

      {/* danger */}
      <section className="card p-4">
        <div className="mb-1 text-[13.5px] font-bold">Erase everything</div>
        <p className="mb-3 text-[12px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
          Removes all transactions, categories and settings from this device. Backups in Drive are not
          affected.
        </p>
        <button
          className="btn w-full"
          style={{ background: 'color-mix(in oklab, var(--tone-bad) 12%, transparent)', color: 'var(--tone-bad)' }}
          onClick={() => setResetOpen(true)}
        >
          <Trash2 size={15} /> Erase all local data
        </button>
      </section>

      <div className="flex items-start gap-2 px-1 pb-2 text-[11px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
        <WifiOff size={13} className="mt-0.5 shrink-0" />
        <span>
          Khata works with no connection at all. Backups only need internet when you tap "Back up now".
        </span>
      </div>

      <Sheet open={restoreOpen} onClose={() => setRestoreOpen(false)} title="Restore">
        <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)]">Pick a snapshot from the list above to restore.</p>
      </Sheet>

      <Confirm
        open={resetOpen}
        danger
        title="Erase all data?"
        body="Every transaction, category and setting on this device will be permanently deleted. This cannot be undone — export a CSV first if you want a copy."
        confirmLabel="Erase everything"
        onCancel={() => setResetOpen(false)}
        onConfirm={async () => {
          await clearAllData()
          setResetOpen(false)
          push({ msg: 'All local data erased', tone: 'info' })
        }}
      />
    </div>
  )
}

function ErrorNote({ msg }: { msg: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12px] font-medium leading-relaxed"
      style={{ background: 'color-mix(in oklab, var(--tone-bad) 12%, transparent)', color: 'var(--tone-bad)' }}
    >
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      {msg}
    </div>
  )
}

function formatBytes(n: number): string {
  if (n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function downloadBlob(text: string, filename: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function hapticOk() {
  try {
    navigator.vibrate?.(14)
  } catch {
    /* ignore */
  }
}
