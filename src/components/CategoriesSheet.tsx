import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type Category, type CategoryKind } from '../db/db'
import { deleteCategory, mergeCategory, sortCats } from '../lib/categories'
import Sheet from './Sheet'

const COLORS = ['#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#64748b']

/** Manage categories: add, rename, recolour, reorder, merge, delete. */
export default function CategoriesSheet({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)

  const list = useMemo(() => sortCats(categories.filter(c => c.kind === kind)), [categories, kind])

  /** Swap with the neighbour; (re)number the whole kind so order is always explicit. */
  async function move(index: number, dir: -1 | 1) {
    const j = index + dir
    if (j < 0 || j >= list.length) return
    const ids = list.map(c => c.id)
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    await db.transaction('rw', db.categories, async () => {
      for (let i = 0; i < ids.length; i++) await db.categories.update(ids[i], { order: i })
    })
  }

  if (editing)
    return (
      <CategoryForm
        initial={editing === 'new' ? null : editing}
        kind={kind}
        all={categories}
        nextOrder={list.length}
        onClose={() => setEditing(null)}
      />
    )

  return (
    <Sheet onClose={onClose} title="Categories">
      <div className="mb-3 flex rounded-2xl bg-slate-200/60 p-1 dark:bg-slate-800">
        {(['expense', 'income'] as const).map(k => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold ${kind === k ? 'bg-indigo-500 text-white shadow' : 'text-slate-500'}`}
          >
            {k === 'expense' ? 'Spending' : 'Income'}
          </button>
        ))}
      </div>
      <p className="mb-2 text-center text-xs text-slate-400">Order here is the order shown when adding transactions</p>
      <div className="mb-4 overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-800/60">
        {list.map((c, i) => (
          <div key={c.id} className="flex items-center border-b border-slate-100 last:border-0 dark:border-slate-700/50">
            <button onClick={() => setEditing(c)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base" style={{ backgroundColor: `${c.color}22` }}>
                {c.emoji}
              </span>
              <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
            </button>
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${c.name} up`}
              className="px-2.5 py-3 text-slate-400 disabled:opacity-20"
            >
              ▲
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === list.length - 1}
              aria-label={`Move ${c.name} down`}
              className="py-3 pl-2.5 pr-4 text-slate-400 disabled:opacity-20"
            >
              ▼
            </button>
          </div>
        ))}
      </div>
      <button onClick={() => setEditing('new')} className="w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        + Add category
      </button>
    </Sheet>
  )
}

function CategoryForm({
  initial,
  kind,
  all,
  nextOrder,
  onClose
}: {
  initial: Category | null
  kind: CategoryKind
  all: Category[]
  nextOrder: number
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '✨')
  const [color, setColor] = useState(initial?.color ?? COLORS[5])
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'idle' | 'delete' | 'merge'>('idle')
  const [mergeInto, setMergeInto] = useState('')

  const k = initial?.kind ?? kind
  const siblings = all.filter(c => c.kind === k && c.id !== initial?.id)

  async function save() {
    const n = name.trim()
    if (!n) return setError('Enter a name')
    if (siblings.some(c => c.name.toLowerCase() === n.toLowerCase())) return setError('That category already exists')
    const fields = { name: n, emoji: emoji.trim() || '✨', color }
    if (initial) await db.categories.update(initial.id, fields)
    else await db.categories.add({ id: uid(), kind: k, order: nextOrder, ...fields })
    onClose()
  }

  async function remove() {
    if (!initial) return
    await deleteCategory(initial)
    onClose()
  }

  async function merge() {
    const target = siblings.find(c => c.id === mergeInto)
    if (!initial || !target) return setError('Pick a category to merge into')
    await mergeCategory(initial, target)
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={initial ? 'Edit category' : 'New category'}>
      <div className="mb-3 flex gap-2">
        <input
          value={emoji}
          onChange={e => setEmoji(e.target.value)}
          maxLength={4}
          className="w-14 rounded-2xl bg-slate-100 py-3 text-center text-xl outline-none dark:bg-slate-800"
        />
        <input
          autoFocus={!initial}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Category name"
          className="min-w-0 flex-1 rounded-2xl bg-slate-100 px-4 py-3 outline-none dark:bg-slate-800"
        />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={c}
            className={`h-8 w-8 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-900' : ''}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}
      <button onClick={save} className="mb-2 w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        Save
      </button>

      {initial && mode === 'idle' && (
        <div className="flex gap-3">
          {siblings.length > 0 && (
            <button onClick={() => setMode('merge')} className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">
              Merge into…
            </button>
          )}
          <button onClick={() => setMode('delete')} className="flex-1 rounded-2xl bg-rose-50 py-3 font-semibold text-rose-500 dark:bg-rose-500/10">
            Delete
          </button>
        </div>
      )}
      {initial && mode === 'delete' && (
        <div className="flex gap-3">
          <button onClick={() => setMode('idle')} className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">
            Cancel
          </button>
          <button onClick={remove} className="flex-1 rounded-2xl bg-rose-500 py-3 font-semibold text-white">
            Delete, move items to Other
          </button>
        </div>
      )}
      {initial && mode === 'merge' && (
        <div>
          <select
            value={mergeInto}
            onChange={e => setMergeInto(e.target.value)}
            className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="">Merge “{initial.name}” into…</option>
            {siblings.map(c => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-3">
            <button onClick={() => setMode('idle')} className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">
              Cancel
            </button>
            <button onClick={merge} className="flex-1 rounded-2xl bg-indigo-500 py-3 font-semibold text-white">
              Merge
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
