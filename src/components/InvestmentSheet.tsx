import { useState } from 'react'
import { db, uid, type Currency, type Investment } from '../db/db'
import { parseAmount, CURRENCY_SYMBOL } from '../lib/money'
import Sheet from './Sheet'

export const INVESTMENT_TYPES: { id: Investment['type']; label: string; emoji: string }[] = [
  { id: 'savings', label: 'Savings', emoji: '💰' },
  { id: 'fd', label: 'Fixed deposit', emoji: '🏦' },
  { id: 'stocks', label: 'Stocks', emoji: '📈' },
  { id: 'crypto', label: 'Crypto', emoji: '🪙' },
  { id: 'epf', label: 'EPF/ETF', emoji: '🏛️' },
  { id: 'other', label: 'Other', emoji: '📦' }
]

/** Add or edit an investment / savings entry. */
export default function InvestmentSheet({ edit, onClose }: { edit?: Investment; onClose: () => void }) {
  const [name, setName] = useState(edit?.name ?? '')
  const [type, setType] = useState<Investment['type']>(edit?.type ?? 'savings')
  const [value, setValue] = useState(edit ? (edit.valueMinor / 100).toFixed(2) : '')
  const [currency, setCurrency] = useState<Currency>(edit?.currency ?? 'LKR')
  const [note, setNote] = useState(edit?.note ?? '')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  async function save() {
    const valueMinor = parseAmount(value)
    if (!name.trim()) return setError('Enter a name')
    if (!valueMinor) return setError('Enter a valid value')
    const fields = { name: name.trim(), type, valueMinor, currency, note: note.trim(), updatedAt: Date.now() }
    if (edit) await db.investments.update(edit.id, fields)
    else await db.investments.add({ id: uid(), ...fields })
    onClose()
  }

  async function remove() {
    if (edit) await db.investments.delete(edit.id)
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={edit ? 'Update investment' : 'New investment / savings'}>
      <input
        autoFocus={!edit}
        placeholder="Name (e.g. NSB Savings, CSE portfolio)"
        value={name}
        onChange={e => setName(e.target.value)}
        className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      <div className="mb-3 grid grid-cols-3 gap-2">
        {INVESTMENT_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`rounded-2xl border-2 p-2.5 text-xs font-medium ${
              type === t.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent bg-slate-50 dark:bg-slate-800/60'
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Current value</p>
      <div className="mb-3 flex items-center gap-1.5">
        <button
          onClick={() => setCurrency(c => (c === 'LKR' ? 'USD' : 'LKR'))}
          className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-2.5 text-xs font-bold text-slate-500 dark:bg-slate-800"
        >
          {CURRENCY_SYMBOL[currency]} {currency}
        </button>
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800/60"
        />
      </div>

      <input
        placeholder="Optional note (e.g. matures 2027-03)…"
        value={note}
        onChange={e => setNote(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      <button onClick={save} className="mb-2 w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        {edit ? 'Save' : 'Add'}
      </button>
      {edit &&
        (confirming ? (
          <div className="flex gap-3">
            <button onClick={() => setConfirming(false)} className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">
              Cancel
            </button>
            <button onClick={remove} className="flex-1 rounded-2xl bg-rose-500 py-3 font-semibold text-white">
              Yes, delete
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="w-full rounded-2xl bg-rose-50 py-3 font-semibold text-rose-500 dark:bg-rose-500/10">
            Delete
          </button>
        ))}
    </Sheet>
  )
}
