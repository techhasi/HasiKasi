import { useState } from 'react'
import { db, type Category } from '../db/db'
import { fmt, parseAmount } from '../lib/money'
import Sheet from './Sheet'

/** Set or clear the monthly (per budget period) limit for an expense category. */
export default function BudgetSheet({ category, spentMinor, onClose }: { category: Category; spentMinor: number; onClose: () => void }) {
  const [amount, setAmount] = useState(category.budgetMinor ? String(category.budgetMinor / 100) : '')
  const [error, setError] = useState('')

  async function save() {
    const minor = parseAmount(amount)
    if (!minor) return setError('Enter a valid amount')
    await db.categories.update(category.id, { budgetMinor: minor })
    onClose()
  }

  async function clear() {
    await db.categories.update(category.id, { budgetMinor: undefined })
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={null}>
      <div className="mb-4 flex flex-col items-center">
        <span
          className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
          style={{ backgroundColor: `${category.color}22` }}
        >
          {category.emoji}
        </span>
        <h2 className="text-lg font-bold">{category.name} budget</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Spent {fmt(spentMinor, 'LKR', { compactCents: true })} this budget month
        </p>
      </div>

      <div className="mb-4 flex items-end justify-center gap-2">
        <span className="mb-2 text-sm font-bold text-slate-400">Rs</span>
        <input
          autoFocus
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-44 bg-transparent text-center text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300 dark:placeholder:text-slate-700"
        />
      </div>
      <p className="mb-4 text-center text-xs text-slate-400">Limit per budget month for this category</p>

      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      <button onClick={save} className="mb-2 w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        Save budget
      </button>
      {category.budgetMinor != null && (
        <button onClick={clear} className="w-full rounded-2xl bg-rose-50 py-3 font-semibold text-rose-500 dark:bg-rose-500/10">
          Remove budget
        </button>
      )}
    </Sheet>
  )
}
