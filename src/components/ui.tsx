import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { money, moneyCompact, uid } from '../lib/util'

/* ---------------- toast ---------------- */

type ToastTone = 'ok' | 'err' | 'info'
interface Toast {
  id: string
  msg: string
  tone: ToastTone
  action?: { label: string; run: () => void }
}

const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} })

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const timers = useRef<Record<string, number>>({})

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = uid()
    setItems((v) => [...v.slice(-2), { ...t, id }])
    const ms = t.action ? 6500 : t.tone === 'err' ? 5200 : 3000
    timers.current[id] = window.setTimeout(() => {
      setItems((v) => v.filter((x) => x.id !== id))
    }, ms)
  }, [])

  const dismiss = (id: string) => {
    window.clearTimeout(timers.current[id])
    setItems((v) => v.filter((x) => x.id !== id))
  }

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className="anim-pop glass glass-strong pointer-events-auto flex max-w-md items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium"
            style={{
              background: 'var(--md-sys-color-surface-container-low)',
              borderColor: t.tone === 'err' ? 'color-mix(in oklab, var(--tone-bad) 45%, var(--md-sys-color-outline-variant))' : 'var(--md-sys-color-outline-variant)',
            }}
            role="status"
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]"
              style={{
                background:
                  t.tone === 'ok'
                    ? 'var(--tone-good)'
                    : t.tone === 'err'
                      ? 'var(--tone-bad)'
                      : 'var(--md-sys-color-on-surface-variant)',
                color: 'var(--md-sys-color-on-primary)',
              }}
            >
              {t.tone === 'ok' ? <Check size={10} strokeWidth={3.5} /> : t.tone === 'err' ? <X size={10} strokeWidth={3.5} /> : 'i'}
            </span>
            <span className="flex-1">{t.msg}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
                className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-bold text-[var(--md-sys-color-primary)]"
                style={{ background: 'color-mix(in oklab, var(--md-sys-color-primary) 14%, transparent)' }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------------- modal / bottom sheet ---------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        className="anim-fade glass-scrim absolute inset-0"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="anim-sheet glass glass-strong safe-b relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-rim-soft)] px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="h-1 w-8 rounded-full bg-[var(--md-sys-color-outline)] sm:hidden" />
            <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="glass-chip flex h-8 w-8 items-center justify-center rounded-full transition hover:brightness-110"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--glass-rim-soft)] px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------- confirm ---------------- */

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      <p className="text-[13.5px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">{body}</p>
      <div className="mt-5 flex gap-2">
        <button className="btn btn-tonal flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={`btn flex-1 ${danger ? 'text-white' : 'btn-primary'}`}
          style={danger ? { background: 'var(--tone-bad)' } : undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}

/* ---------------- misc ---------------- */

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className="glass-sm inline-flex rounded-xl p-0.5"
      role="tablist"
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`rounded-[10px] font-semibold transition-all duration-200 ${
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-[13px]'
            } ${on ? 'bg-[var(--md-sys-color-surface)] shadow-sm' : 'text-[var(--md-sys-color-on-surface-variant)]'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'color-mix(in oklab, var(--md-sys-color-primary) 14%, transparent)', color: 'var(--md-sys-color-primary)' }}
      >
        {icon}
      </div>
      <h3 className="text-[15px] font-bold">{title}</h3>
      <p className="mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad' | 'warn' | 'default'
  icon?: ReactNode
}) {
  const color =
    tone === 'good'
      ? 'var(--tone-good)'
      : tone === 'bad'
        ? 'var(--tone-bad)'
        : tone === 'warn'
          ? 'var(--tone-warn)'
          : 'var(--md-sys-color-on-surface)'
  return (
    <div className="glass glass-sm glass-enter p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon && <span style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{icon}</span>}
        <span className="label">{label}</span>
      </div>
      <div className="tnum text-[19px] font-bold leading-tight tracking-tight" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">{sub}</div>}
    </div>
  )
}

/** Haptics where available — makes a tap feel like a real app. */
export function haptic(pattern: number | number[] = 8): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern)
  } catch {
    /* ignore */
  }
}

/** Shared formatting hook so views don't re-derive currency each render. */
export function useFmt(currency: string, decimals: number) {
  return useMemo(
    () => ({
      money: (p: number) => money(p, currency, decimals),
      compact: (p: number) => moneyCompact(p, currency),
    }),
    [currency, decimals],
  )
}
