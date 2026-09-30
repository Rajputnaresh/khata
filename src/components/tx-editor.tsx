import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Repeat, Sparkles, Trash2 } from 'lucide-react'
import type { Category, Tx, TxType } from '../lib/types'
import { addTx, deleteTx, restoreTx, updateTx } from '../lib/store'
import { parseAmount, today } from '../lib/util'
import { haptic, Sheet, useToast } from './ui'

/** Icon name -> lucide component, resolved lazily to keep the bundle lean. */
import {
  UtensilsCrossed, ShoppingBasket, Car, Fuel, Home, Zap, HeartPulse, ShoppingBag,
  GraduationCap, Clapperboard, Plane, ReceiptIndianRupee, Gift, Wallet, Ellipsis,
  Briefcase, Sparkles as SparklesI, Landmark, Building2, Undo2, Coins, Tag,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  UtensilsCrossed, ShoppingBasket, Car, Fuel, Home, Zap, HeartPulse, ShoppingBag,
  GraduationCap, Clapperboard, Plane, ReceiptIndianRupee, Gift, Wallet, Ellipsis,
  Briefcase, Sparkles: SparklesI, Landmark, Building2, Undo2, Coins, Tag,
}

/** The icon palette offered in the category editor. */
export const ICON_CHOICES = Object.keys(ICONS).sort()

export function CategoryIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const Cmp = ICONS[name] ?? Tag
  return <Cmp className={className} strokeWidth={2.2} />
}

export interface DraftTx {
  id?: string
  type: TxType
  amount: string
  categoryId: string
  note: string
  date: string
  recurring: boolean
  status: Tx['status']
}

const empty = (type: TxType, firstCat: string): DraftTx => ({
  type,
  amount: '',
  categoryId: firstCat,
  note: '',
  date: today(),
  recurring: false,
  status: 'cleared',
})

export function TxEditor({
  open,
  onClose,
  categories,
  editing,
  initialType = 'expense',
  currency,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  categories: Category[]
  editing?: Tx | null
  initialType?: TxType
  currency: string
  onSaved?: (tx: Tx) => void
}) {
  const { push } = useToast()
  const [draft, setDraft] = useState<DraftTx>(() =>
    editing
      ? {
          id: editing.id,
          type: editing.type,
          amount: (editing.amount / 100).toFixed(2),
          categoryId: editing.categoryId,
          note: editing.note,
          date: editing.date,
          recurring: editing.recurring,
          status: editing.status,
        }
      : empty(initialType, categories.find((c) => c.kind === initialType && !c.archived)?.id ?? 'c_other'),
  )
  const [saving, setSaving] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  const saved = useRef<Tx | null>(null)

  useEffect(() => {
    if (!open) return
    saved.current = null
    setDraft(
      editing
        ? {
            id: editing.id,
            type: editing.type,
            amount: (editing.amount / 100).toFixed(2),
            categoryId: editing.categoryId,
            note: editing.note,
            date: editing.date,
            recurring: editing.recurring,
            status: editing.status,
          }
        : empty(
            initialType,
            categories.find((c) => c.kind === initialType && !c.archived)?.id ?? 'c_other',
          ),
    )
    // Focus the amount so the common case is a number and a save.
    const t = setTimeout(() => amountRef.current?.focus(), 260)
    return () => clearTimeout(t)
  }, [open, editing, initialType, categories])

  const visible = useMemo(
    () => categories.filter((c) => c.kind === draft.type && !c.archived).sort((a, b) => a.sort - b.sort),
    [categories, draft.type],
  )

  const paise = parseAmount(draft.amount)
  const valid = paise !== null && paise > 0 && !!draft.categoryId && !!draft.date
  const symbol = currency === 'INR' ? '₹' : `${currency} `

  const flip = (t: TxType) => {
    setDraft((d) => ({
      ...d,
      type: t,
      categoryId: categories.find((c) => c.kind === t && !c.archived)?.id ?? d.categoryId,
    }))
  }

  const save = async () => {
    if (!valid || paise === null) return
    setSaving(true)
    try {
      const payload = {
        type: draft.type,
        amount: paise,
        categoryId: draft.categoryId,
        note: draft.note.trim(),
        date: draft.date,
        status: draft.status,
        recurring: draft.recurring,
      }
      if (editing) {
        await updateTx(editing.id, payload)
        const merged: Tx = { ...editing, ...payload, updatedAt: Date.now() }
        saved.current = merged
        onSaved?.(merged)
        push({ msg: 'Updated', tone: 'ok' })
      } else {
        const tx = await addTx(payload)
        saved.current = tx
        onSaved?.(tx)
        haptic(12)
        push({
          msg: `${draft.type === 'expense' ? 'Expense' : 'Income'} saved`,
          tone: 'ok',
          action: {
            label: 'Undo',
            run: async () => {
              await deleteTx(tx.id)
              push({ msg: 'Reverted', tone: 'info' })
            },
          },
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!editing) return
    const copy = { ...editing }
    await deleteTx(editing.id)
    onClose()
    push({
      msg: 'Entry deleted',
      tone: 'info',
      action: {
        label: 'Undo',
        run: async () => {
          await restoreTx(copy)
          push({ msg: 'Restored', tone: 'ok' })
        },
      },
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Edit entry' : draft.type === 'expense' ? 'Add expense' : 'Add income'}
      footer={
        <div className="flex gap-2">
          {editing && (
            <button className="btn btn-tonal px-3" onClick={remove} aria-label="Delete">
              <Trash2 size={17} style={{ color: 'var(--tone-bad)' }} />
            </button>
          )}
          <button className="btn btn-primary flex-1 py-3 text-[15px]" onClick={save} disabled={!valid || saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : `Add ${draft.type}`}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* type toggle — Material 3 segmented button */}
        <div
          className="grid grid-cols-2 gap-1 p-1"
          style={{ background: 'var(--md-sys-color-surface-container-highest)', borderRadius: 'var(--radius-full)' }}
        >
          {(['expense', 'income'] as const).map((t) => {
            const on = draft.type === t
            const isExpense = t === 'expense'
            return (
              <button
                key={t}
                onClick={() => flip(t)}
                className="py-2.5 label-lg capitalize transition-all"
                style={{
                  background: on
                    ? isExpense
                      ? 'var(--md-sys-color-primary)'
                      : 'var(--md-sys-color-success)'
                    : 'transparent',
                  color: on
                    ? isExpense
                      ? 'var(--md-sys-color-on-primary)'
                      : 'var(--md-sys-color-on-success)'
                    : 'var(--md-sys-color-on-surface-variant)',
                  boxShadow: on ? 'var(--md-sys-elevation-level1)' : 'none',
                  borderRadius: 'var(--radius-full)',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>

        {/* amount */}
        <div className="text-center">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--md-sys-color-on-surface-variant)]">
            Amount
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-[26px] font-medium text-[var(--md-sys-color-on-surface-variant)]">{symbol}</span>
            <input
              ref={amountRef}
              inputMode="decimal"
              autoComplete="off"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              placeholder="0"
              aria-label="Amount"
              className="tnum w-full max-w-[220px] bg-transparent text-center text-[40px] font-bold tracking-tight outline-none placeholder:text-[var(--md-sys-color-outline)]"
              style={{ color: draft.type === 'expense' ? 'var(--md-sys-color-on-surface)' : 'var(--tone-good)' }}
            />
          </div>
          {paise !== null && paise > 0 && (
            <div className="mt-1 text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
              {draft.type === 'expense' ? 'Spent' : 'Received'}
            </div>
          )}
        </div>

        {/* categories — Material 3 icon+label grid, selection via container role */}
        <div>
          <div className="label mb-2">Category</div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
            {visible.map((c) => {
              const on = c.id === draft.categoryId
              return (
                <button
                  key={c.id}
                  onClick={() => setDraft({ ...draft, categoryId: c.id })}
                  className="flex flex-col items-center gap-1 px-1 py-2 transition-all"
                  style={{
                    background: on
                      ? `color-mix(in oklab, ${c.color} 18%, var(--md-sys-color-surface))`
                      : 'transparent',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: on ? `inset 0 0 0 2px ${c.color}` : 'none',
                  }}
                  aria-pressed={on}
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center transition-transform"
                    style={{
                      background: on ? c.color : `color-mix(in oklab, ${c.color} 16%, transparent)`,
                      color: on ? 'var(--md-sys-color-on-primary)' : c.color,
                      borderRadius: 'var(--radius-full)',
                      transform: on ? 'scale(1.05)' : 'none',
                    }}
                  >
                    <CategoryIcon name={c.icon} className="h-4 w-4" />
                  </span>
                  <span
                    className="w-full truncate text-center text-[10px] font-medium leading-tight"
                    style={{ color: on ? 'var(--md-sys-color-on-surface)' : 'var(--md-sys-color-on-surface-variant)' }}
                  >
                    {c.name}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* note */}
        <div>
          <label className="label mb-1.5 block" htmlFor="tx-note">
            Note <span className="font-normal normal-case tracking-normal text-[var(--md-sys-color-on-surface-variant)]">(optional)</span>
          </label>
          <input
            id="tx-note"
            className="glass-field"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder={draft.type === 'expense' ? 'Lunch at Cafe Blue' : 'Salary for October'}
            maxLength={80}
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(draft.type === 'expense'
              ? ['Groceries', 'Uber', 'Fuel', 'Tea', 'Medicine']
              : ['Salary', 'Bonus', 'Refund']
            ).map((s) => (
              <button
                key={s}
                onClick={() => setDraft({ ...draft, note: s })}
                className="glass-chip text-[11px] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-highest)]"
              >
                <Sparkles size={10} />
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* date + options */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label mb-1.5 block" htmlFor="tx-date">
              Date
            </label>
            <input
              id="tx-date"
              type="date"
              className="glass-field"
              value={draft.date}
              max={today()}
              onChange={(e) => setDraft({ ...draft, date: e.target.value || today() })}
            />
          </div>
          <div>
            <span className="label mb-1.5 block">Options</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setDraft({ ...draft, recurring: !draft.recurring })}
                className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border text-[11px] font-bold transition-all"
                style={{
                  borderColor: draft.recurring ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)',
                  background: draft.recurring
                    ? 'color-mix(in oklab, var(--md-sys-color-primary) 14%, transparent)'
                    : 'var(--md-sys-color-surface-container-highest)',
                  color: draft.recurring ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-on-surface-variant)',
                }}
                aria-pressed={draft.recurring}
              >
                <Repeat size={13} />
                Bills
              </button>
              <button
                onClick={() =>
                  setDraft({ ...draft, status: draft.status === 'cleared' ? 'pending' : 'cleared' })
                }
                className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border text-[11px] font-bold transition-all"
                style={{
                  borderColor: draft.status === 'pending' ? 'var(--tone-warn)' : 'var(--md-sys-color-outline-variant)',
                  background:
                    draft.status === 'pending'
                      ? 'color-mix(in oklab, var(--tone-warn) 16%, transparent)'
                      : 'var(--md-sys-color-surface-container-highest)',
                  color: draft.status === 'pending' ? 'var(--tone-warn)' : 'var(--md-sys-color-on-surface-variant)',
                }}
                aria-pressed={draft.status === 'pending'}
              >
                <Check size={13} />
                {draft.status === 'pending' ? 'Pending' : 'Cleared'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
