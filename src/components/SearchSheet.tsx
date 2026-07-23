import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn, type TxnType } from '../db/db'
import { fmt } from '../lib/money'
import { friendlyDate } from '../lib/dates'
import Sheet from './Sheet'
import TxnDetail from './TxnDetail'

const TYPE_FILTERS: { id: TxnType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'expense', label: 'Expenses' },
  { id: 'income', label: 'Income' },
  { id: 'transfer', label: 'Transfers' }
]

/** Search the full transaction history by text, type, and category. */
export default function SearchSheet({ onClose }: { onClose: () => void }) {
  const txns = useLiveQuery(() => db.txns.orderBy('date').reverse().toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TxnType | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [detail, setDetail] = useState<Txn | null>(null)

  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return txns.filter(t => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (categoryFilter !== 'all' && t.categoryId !== categoryFilter) return false
      if (!q) return true
      const cat = catById.get(t.categoryId)
      const acc = accById.get(t.accountId)
      const toAcc = t.toAccountId ? accById.get(t.toAccountId) : undefined
      const haystack = [
        t.note,
        cat?.name,
        acc?.name,
        toAcc?.name,
        (t.amountMinor / 100).toFixed(2),
        String(Math.round(t.amountMinor / 100)),
        t.date
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [txns, query, typeFilter, categoryFilter, catById, accById])

  return (
    <Sheet onClose={onClose} title="🔍 Search">
      <input
        autoFocus
        placeholder="Search note, category, account, amount…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      {/* Type chips */}
      <div className="mb-2 flex gap-1.5 overflow-x-auto">
        {TYPE_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setTypeFilter(f.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              typeFilter === f.id
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Category chips (hidden for transfers) */}
      {typeFilter !== 'transfer' && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              categoryFilter === 'all'
                ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            Any category
          </button>
          {categories
            .filter(c => typeFilter === 'all' || c.kind === typeFilter)
            .map(c => (
              <button
                key={c.id}
                onClick={() => setCategoryFilter(f => (f === c.id ? 'all' : c.id))}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  categoryFilter === c.id
                    ? 'text-white'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
                style={categoryFilter === c.id ? { backgroundColor: c.color } : undefined}
              >
                {c.emoji} {c.name}
              </button>
            ))}
        </div>
      )}

      <p className="mb-2 text-xs text-slate-400">
        {results.length} result{results.length === 1 ? '' : 's'}
      </p>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-800/60">
        {results.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-400">Nothing matches.</p>
        )}
        {results.slice(0, 100).map(t => {
          const isTransfer = t.type === 'transfer'
          const isAdjustment = !!t.adjustment
          const cat = catById.get(t.categoryId)
          const acc = accById.get(t.accountId)
          const toAcc = t.toAccountId ? accById.get(t.toAccountId) : undefined
          return (
            <button
              key={t.id}
              onClick={() => setDetail(t)}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 active:bg-slate-50 dark:border-slate-700/50 dark:active:bg-slate-700/30"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
                style={{ backgroundColor: isTransfer || isAdjustment ? '#0ea5e922' : `${cat?.color ?? '#64748b'}22` }}
              >
                {isAdjustment ? '⚖️' : isTransfer ? '⇄' : (cat?.emoji ?? '❓')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {isAdjustment ? 'Adjustment' : isTransfer ? 'Transfer' : (cat?.name ?? 'Unknown')}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {friendlyDate(t.date)} · {isTransfer ? `${acc?.name} → ${toAcc?.name}` : acc?.name}
                  {t.note && ` · ${t.note}`}
                </span>
              </span>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  isTransfer ? 'text-sky-500' : t.type === 'expense' ? 'text-rose-500' : 'text-emerald-500'
                }`}
              >
                {isTransfer ? '' : t.type === 'expense' ? '−' : '+'}
                {fmt(t.amountMinor, t.currency, { compactCents: true })}
              </span>
            </button>
          )
        })}
        {results.length > 100 && (
          <p className="p-3 text-center text-xs text-slate-400">Showing first 100 — refine your search</p>
        )}
      </div>

      {detail && <TxnDetail txn={detail} onClose={() => setDetail(null)} />}
    </Sheet>
  )
}
