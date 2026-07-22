import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, DEFAULT_SETTINGS, type Account } from '../db/db'
import { fmt, toLKR, parseAmount } from '../lib/money'
import Sheet from '../components/Sheet'

const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Cash', emoji: '💵' },
  { id: 'bank', label: 'Bank', emoji: '🏦' },
  { id: 'card', label: 'Card', emoji: '💳' }
] as const

const ACCOUNT_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#ef4444', '#64748b']

export default function Accounts() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const [adding, setAdding] = useState(false)

  const usdRate = settings?.usdRate ?? 300

  const balances = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of accounts) map.set(a.id, a.openingMinor)
    for (const t of txns) {
      const lkr = toLKR(t.amountMinor, t.currency, usdRate)
      if (t.type === 'transfer') {
        map.set(t.accountId, (map.get(t.accountId) ?? 0) - lkr)
        if (t.toAccountId) map.set(t.toAccountId, (map.get(t.toAccountId) ?? 0) + lkr)
      } else {
        map.set(t.accountId, (map.get(t.accountId) ?? 0) + (t.type === 'expense' ? -lkr : lkr))
      }
    }
    return map
  }, [accounts, txns, usdRate])

  const total = [...balances.values()].reduce((s, v) => s + v, 0)

  return (
    <div className="px-4 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <button
          onClick={() => setAdding(true)}
          className="rounded-xl bg-indigo-500 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/30"
        >
          + Add
        </button>
      </div>

      <div className="mb-5 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 text-white shadow-xl dark:from-indigo-600 dark:to-purple-700">
        <p className="text-xs uppercase tracking-widest text-slate-300 dark:text-indigo-200">Net worth</p>
        <p className="text-3xl font-bold tabular-nums">{fmt(total, 'LKR', { compactCents: true })}</p>
      </div>

      <div className="space-y-3">
        {accounts.map(a => {
          const bal = balances.get(a.id) ?? 0
          const t = ACCOUNT_TYPES.find(t => t.id === a.type)
          return (
            <div key={a.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-800/60">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl" style={{ backgroundColor: `${a.color}22` }}>
                {t?.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{a.name}</p>
                <p className="text-xs capitalize text-slate-400">{a.type}</p>
              </div>
              <p className={`text-base font-bold tabular-nums ${bal < 0 ? 'text-rose-500' : ''}`}>
                {fmt(bal, 'LKR', { compactCents: true })}
              </p>
            </div>
          )
        })}
      </div>

      {adding && <AddAccountSheet onClose={() => setAdding(false)} />}
    </div>
  )
}

function AddAccountSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<Account['type']>('bank')
  const [color, setColor] = useState(ACCOUNT_COLORS[1])
  const [opening, setOpening] = useState('')
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) return setError('Enter a name')
    const openingMinor = opening.trim() ? parseAmount(opening) : 0
    if (openingMinor === null) return setError('Invalid opening balance')
    await db.accounts.add({ id: uid(), name: name.trim(), type, color, openingMinor })
    onClose()
  }

  return (
    <Sheet onClose={onClose} title="New account">
      <input
        autoFocus
        placeholder="Account name (e.g. HNB Savings)"
        value={name}
        onChange={e => setName(e.target.value)}
        className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />
      <div className="mb-3 flex gap-2">
        {ACCOUNT_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`flex-1 rounded-2xl border-2 p-3 text-sm font-medium ${
              type === t.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent bg-slate-50 dark:bg-slate-800/60'
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {ACCOUNT_COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`h-7 w-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-slate-400 ring-offset-1' : ''}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <input
        placeholder="Opening balance (Rs, optional)"
        inputMode="decimal"
        value={opening}
        onChange={e => setOpening(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />
      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}
      <button onClick={save} className="w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        Add account
      </button>
    </Sheet>
  )
}
