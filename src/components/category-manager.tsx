import { useMemo, useState } from 'react'
import {
  ArrowDown, ArrowUp, Check, ChevronDown, GripVertical, Pencil, Plus,
  Target, Trash2,
} from 'lucide-react'
import { db } from '../lib/db'
import { useCategories, useSettings } from '../lib/store'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Category, TxType } from '../lib/types'
import { money, parseAmount, uid } from '../lib/util'
import { CategoryIcon, ICON_CHOICES } from './tx-editor'
import { Confirm, Sheet, haptic, useToast } from './ui'

/**
 * Full category management: create, rename, recolour, re-icon, set a monthly
 * cap, reorder, and archive. Reordering and archiving are the two things a
 * static seed list can never do, so they are first-class here.
 */
export function CategoryManager() {
  const { categories } = useCategories()
  const settings = useSettings()
  const { push } = useToast()
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState<TxType | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const [draft, setDraft] = useState({
    name: '',
    icon: 'Tag',
    color: '#E8734A',
    kind: 'expense' as TxType,
    monthlyLimit: '',
  })

  // How many entries each category holds, so the user can see what they are
  // about to affect before deleting or archiving.
  const counts = useCountsByCategory()

  const open = (c: Category) => {
    setDraft({
      name: c.name,
      icon: c.icon,
      color: c.color,
      kind: c.kind,
      monthlyLimit: c.monthlyLimit > 0 ? (c.monthlyLimit / 100).toFixed(0) : '',
    })
    setEditing(c)
  }

  const openNew = (kind: TxType) => {
    setDraft({ name: '', icon: 'Tag', color: '#E8734A', kind, monthlyLimit: '' })
    setCreating(kind)
  }

  const close = () => {
    setEditing(null)
    setCreating(null)
  }

  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      push({ msg: 'Give the category a name', tone: 'err' })
      return
    }
    const limit = draft.monthlyLimit ? parseAmount(draft.monthlyLimit) : 0
    const now = Date.now()

    if (editing) {
      await db.categories.update(editing.id, {
        name,
        icon: draft.icon,
        color: draft.color,
        monthlyLimit: Math.max(0, limit ?? 0),
        updatedAt: now,
      } as never)
      push({ msg: `Updated ${name}`, tone: 'ok' })
    } else {
      const max = Math.max(0, ...categories.map((c) => c.sort))
      await db.categories.add({
        id: uid('c'),
        name,
        icon: draft.icon,
        color: draft.color,
        kind: draft.kind,
        monthlyLimit: Math.max(0, limit ?? 0),
        archived: false,
        sort: max + 1,
      } as never)
      push({ msg: `Added ${name}`, tone: 'ok' })
    }
    haptic(10)
    close()
  }

  const remove = async (c: Category) => {
    // Reassign rather than orphan: a transaction with a missing categoryId would
    // silently vanish from every rollup, so point them at the catch-all.
    const used = await db.tx.where('categoryId').equals(c.id).count()
    const fallback =
      categories.find((x) => x.kind === c.kind && x.name.toLowerCase() === 'other' && x.id !== c.id) ??
      categories.find((x) => x.kind === c.kind && x.id !== c.id)
    if (used > 0 && fallback) {
      await db.tx.where('categoryId').equals(c.id).modify({ categoryId: fallback.id })
    } else if (used > 0) {
      await db.tx.where('categoryId').equals(c.id).delete()
    }
    await db.categories.delete(c.id)
    setConfirmDelete(null)
    haptic(12)
    push({
      msg:
        used > 0
          ? `Deleted ${c.name} — ${used} entr${used === 1 ? 'y' : 'ies'} moved to ${fallback?.name ?? 'deleted'}`
          : `Deleted ${c.name}`,
      tone: 'info',
    })
  }

  /** Move a category one slot within its own kind group. */
  const move = async (c: Category, dir: -1 | 1) => {
    const group = categories
      .filter((x) => x.kind === c.kind && x.archived === c.archived)
      .sort((a, b) => a.sort - b.sort)
    const i = group.findIndex((x) => x.id === c.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= group.length) return
    const other = group[j]!
    // Swap sort values.
    await db.categories.update(c.id, { sort: other.sort } as never)
    await db.categories.update(other.id, { sort: c.sort } as never)
    haptic(6)
  }

  const toggleArchive = async (c: Category) => {
    await db.categories.update(c.id, { archived: !c.archived } as never)
    push({ msg: c.archived ? `Restored ${c.name}` : `Archived ${c.name}`, tone: 'info' })
  }

  const visible = categories.filter((c) => (showArchived ? true : !c.archived))
  const expenseList = visible.filter((c) => c.kind === 'expense')
  const incomeList = visible.filter((c) => c.kind === 'income')

  const renderGroup = (list: Category[], kind: TxType) => (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="label">{kind === 'expense' ? 'Expense categories' : 'Income categories'}</div>
        <button
          onClick={() => openNew(kind)}
          className="glass-chip text-[11px]"
          style={{ height: '1.75rem' }}
        >
          <Plus size={12} /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {list.map((c) => (
          <CategoryRow
            key={c.id}
            cat={c}
            currency={settings.currency}
            onEdit={() => open(c)}
            onDelete={() => setConfirmDelete(c)}
            onMove={(d) => move(c, d)}
            onArchive={() => toggleArchive(c)}
            showArchived={showArchived}
            first={list[0]?.id === c.id}
            last={list[list.length - 1]?.id === c.id}
            counts={counts}
          />
        ))}
        {list.length === 0 && (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
            No {kind} categories yet.
          </p>
        )}
      </div>
    </section>
  )

  return (
    <div className="space-y-5">
      {renderGroup(expenseList, 'expense')}
      {renderGroup(incomeList, 'income')}

      <div className="flex justify-center pt-1">
        <button className="glass-chip" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? <Check size={12} /> : <ChevronDown size={12} />}
          {showArchived ? 'Hiding archived' : 'Show archived'}
        </button>
      </div>

      {/* editor */}
      <Sheet
        open={!!editing || !!creating}
        onClose={close}
        title={editing ? 'Edit category' : `New ${creating === 'income' ? 'income' : 'expense'} category`}
        footer={
          <div className="flex gap-2">
            {editing && (
              <button
                className="glass-chip px-3"
                onClick={() => {
                  toggleArchive(editing)
                  close()
                }}
              >
                {editing.archived ? 'Restore' : 'Archive'}
              </button>
            )}
            <button className="btn btn-primary flex-1" onClick={save} disabled={!draft.name.trim()}>
              {editing ? 'Save' : 'Create'}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* live preview */}
          <div className="flex justify-center py-2">
            <div
              className="flex w-24 flex-col items-center gap-2 rounded-2xl px-3 py-4"
              style={{
                background: `color-mix(in oklab, ${draft.color} 18%, transparent)`,
                boxShadow: `inset 0 0 0 2px ${draft.color}`,
              }}
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-2xl text-white"
                style={{ background: draft.color }}
              >
                <CategoryIcon name={draft.icon} className="h-6 w-6" />
              </span>
              <span className="w-full truncate text-center text-[11px] font-semibold">
                {draft.name || 'Preview'}
              </span>
            </div>
          </div>

          <div>
            <label className="label mb-1.5 block" htmlFor="cat-name">
              Name
            </label>
            <input
              id="cat-name"
              className="glass-field"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={draft.kind === 'expense' ? 'e.g. Groceries' : 'e.g. Salary'}
              maxLength={28}
              autoFocus
            />
          </div>

          <div>
            <div className="label mb-2">Colour</div>
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((s) => (
                <button
                  key={s}
                  onClick={() => setDraft({ ...draft, color: s })}
                  className="h-8 w-8 rounded-full transition-transform"
                  style={{
                    background: s,
                    boxShadow: draft.color.toLowerCase() === s.toLowerCase()
                      ? `0 0 0 3px var(--md-sys-color-surface), 0 0 0 5px ${s}`
                      : `inset 0 1px 0 rgb(255 255 255 / 0.3)`,
                    transform: draft.color.toLowerCase() === s.toLowerCase() ? 'scale(1.08)' : 'none',
                  }}
                  aria-label={`Colour ${s}`}
                />
              ))}
              <label className="glass-chip cursor-pointer" title="Custom colour">
                <span
                  className="h-4 w-4 rounded-full"
                  style={{
                    background: `conic-gradient(from 0deg, #E8734A, #D9A23B, #3E9C6A, #4E8FD4, #8B6BC7, #C4577B, #E8734A)`,
                  }}
                />
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  className="sr-only w-0 h-0"
                />
              </label>
            </div>
          </div>

          <div>
            <div className="label mb-2">Icon</div>
            <div className="grid max-h-52 grid-cols-7 gap-1.5 overflow-y-auto pr-1">
              {ICON_CHOICES.map((name) => {
                const on = draft.icon === name
                return (
                  <button
                    key={name}
                    onClick={() => setDraft({ ...draft, icon: name })}
                    className="flex h-10 items-center justify-center rounded-xl transition-all"
                    style={{
                      background: on ? draft.color : 'var(--glass-fill-subtle)',
                      color: on ? '#fff' : 'var(--md-sys-color-on-surface-variant)',
                      boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--glass-rim-soft)',
                    }}
                    aria-label={name}
                    aria-pressed={on}
                  >
                    <CategoryIcon name={name} className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
          </div>

          {draft.kind === 'expense' && (
            <div>
              <label className="label mb-1.5 block" htmlFor="cat-limit">
                Monthly cap (optional)
              </label>
              <div className="relative">
                <Target
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--md-sys-color-on-surface-variant)' }}
                />
                <input
                  id="cat-limit"
                  className="glass-field tnum pl-9"
                  inputMode="decimal"
                  value={draft.monthlyLimit}
                  onChange={(e) => setDraft({ ...draft, monthlyLimit: e.target.value })}
                  placeholder="No cap"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                Khata will flag this category once you pass the cap.
              </p>
            </div>
          )}
        </div>
      </Sheet>

      <Confirm
        open={!!confirmDelete}
        danger
        title={`Delete ${confirmDelete?.name ?? 'category'}?`}
        body="Transactions already filed under it are not deleted — they move to 'Other'. This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
      />
    </div>
  )
}

/** Count of transactions per category id. */
function useCountsByCategory(): Map<string, number> {
  const rows = useLiveQuery(
    async () => {
      const out = new Map<string, number>()
      await db.tx.each((t) => out.set(t.categoryId, (out.get(t.categoryId) ?? 0) + 1))
      return out
    },
    [],
    new Map<string, number>(),
  )
  return useMemo(() => rows ?? new Map(), [rows])
}

function CategoryRow({
  cat,
  currency,
  onEdit,
  onDelete,
  onMove,
  onArchive,
  showArchived,
  first,
  last,
  counts,
}: {
  cat: Category
  currency: string
  onEdit: () => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onArchive: () => void
  showArchived: boolean
  first: boolean
  last: boolean
  counts: Map<string, number>
}) {
  return (
    <div
      className="glass glass-sm flex items-center gap-3 px-3 py-2.5"
      style={{ opacity: cat.archived ? 0.55 : 1 }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ background: cat.color, boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.3)' }}
      >
        <CategoryIcon name={cat.icon} className="h-4 w-4" />
      </span>

      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13.5px] font-semibold">{cat.name}</div>
        <div className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
          {[
            `${counts.get(cat.id) ?? 0} entr${(counts.get(cat.id) ?? 0) === 1 ? 'y' : 'ies'}`,
            cat.monthlyLimit > 0 ? `cap ${money(cat.monthlyLimit, currency, 0)}/mo` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {!showArchived && (
          <>
            <IconBtn label="Move up" onClick={() => onMove(-1)} disabled={first}>
              <ArrowUp size={13} />
            </IconBtn>
            <IconBtn label="Move down" onClick={() => onMove(1)} disabled={last}>
              <ArrowDown size={13} />
            </IconBtn>
          </>
        )}
        <IconBtn label={cat.archived ? 'Restore' : 'Archive'} onClick={onArchive}>
          {cat.archived ? <Check size={13} /> : <GripVertical size={13} />}
        </IconBtn>
        <IconBtn label="Edit" onClick={onEdit}>
          <Pencil size={13} />
        </IconBtn>
        <IconBtn label="Delete" onClick={onDelete} danger>
          <Trash2 size={13} />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  label,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-25"
      style={{
        background: danger ? 'color-mix(in oklab, var(--md-sys-color-error) 14%, transparent)' : 'transparent',
        color: danger
          ? 'var(--md-sys-color-error)'
          : 'var(--md-sys-color-on-surface-variant)',
      }}
    >
      {children}
    </button>
  )
}

/** Curated swatches: all tone-mapped, so every one stays readable on glass. */
const SWATCHES = [
  '#E8734A', // saffron (primary)
  '#D9A23B', // amber
  '#3E9C6A', // green
  '#2E9E8F', // teal
  '#4E8FD4', // blue
  '#8B6BC7', // violet
  '#C4577B', // clay / rose
  '#6B6058', // stone
  '#D1674E',
  '#5C8AC4',
  '#B368C4',
  '#9A7B4F',
]
