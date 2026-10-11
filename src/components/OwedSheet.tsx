import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Currency } from '../db/db'
import { fmt, parseAmount } from '../lib/money'
import { friendlyDate, todayISO } from '../lib/dates'
import { recordRepayment, viewOf, writeOff, type ReceivableView } from '../lib/receivables'
import Sheet from './Sheet'

interface Group {
  key: string
  person: string
  currency: Currency
  items: ReceivableView[]
  remainingMinor: number
}

/** Money friends owe me, grouped by person, with repayments and write-offs. */
export default function OwedSheet({ onClose }: { onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const receivables = useLiveQuery(() => db.receivables.toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const [paying, setPaying] = useState<string | null>(null)
  const [error, setError] = useState('')

  const views = useMemo(() => receivables.map(r => viewOf(r, txns)), [receivables, txns])
  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  const groups = useMemo(() => {
    const m = new Map<string, Group>()
    for (const v of views) {
      if (v.remainingMinor <= 0) continue
      const key = `${v.r.person.trim().toLowerCase()}|${v.r.currency}`
      const g = m.get(key) ?? { key, person: v.r.person.trim(), currency: v.r.currency, items: [], remainingMinor: 0 }
      g.items.push(v)
      g.remainingMinor += v.remainingMinor
      m.set(key, g)
    }
    for (const g of m.values()) g.items.sort((a, b) => (a.txn?.date ?? '').localeCompare(b.txn?.date ?? ''))
    return [...m.values()].sort((a, b) => b.remainingMinor - a.remainingMinor)
  }, [views])
  const settled = views.filter(v => v.remainingMinor <= 0)

  return (
    <Sheet onClose={onClose} title="🤝 Owed to me">
      {groups.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">
          Nobody owes you anything.
          <br />
          Turn on “Friends owe me part of this” when adding an expense.
        </p>
      )}

      <div className="space-y-4">
        {groups.map(g => (
          <div key={g.key} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">{g.person || 'Friends'}</p>
              <p className="text-lg font-bold tabular-nums text-amber-500">{fmt(g.remainingMinor, g.currency, { compactCents: true })}</p>
            </div>

            <div className="mb-3 space-y-1.5">
              {g.items.map(v => (
                <div key={v.r.id} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="min-w-0 flex-1 truncate">
                    {v.txn ? friendlyDate(v.txn.date) : '—'} · {v.txn?.note || (v.txn ? catName.get(v.txn.categoryId) : '') || 'Expense'}
                  </span>
                  <span className="tabular-nums">
                    {fmt(v.remainingMinor, v.r.currency, { compactCents: true })}
                    {v.paidMinor > 0 && ` of ${fmt(v.r.amountMinor, v.r.currency, { compactCents: true })}`}
                  </span>
                  <button
                    onClick={async () => {
                      if (window.confirm(`Write off ${fmt(v.remainingMinor, v.r.currency, { compactCents: true })}? It will count as your own spending.`))
                        await writeOff(v.r, v.remainingMinor)
                    }}
                    className="rounded-lg px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 underline"
                  >
                    write off
                  </button>
                </div>
              ))}
            </div>

            {paying === g.key ? (
              <PayForm
                group={g}
                accounts={accounts}
                defaultAccountId={settings?.defaultIncomeAccountId}
                onCancel={() => setPaying(null)}
                onError={setError}
                onDone={() => setPaying(null)}
              />
            ) : (
              <button
                onClick={() => { setError(''); setPaying(g.key) }}
                className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white"
              >
                Received a payment
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      {settled.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400">Settled ({settled.length})</summary>
          <div className="mt-2 space-y-1 text-xs text-slate-400">
            {settled.map(v => (
              <p key={v.r.id}>
                ✅ {v.r.person || 'Friends'} · {fmt(v.r.amountMinor, v.r.currency, { compactCents: true })}
                {v.txn && ` · ${friendlyDate(v.txn.date)}`}
                {(v.r.writtenOffMinor ?? 0) > 0 && ` · wrote off ${fmt(v.r.writtenOffMinor!, v.r.currency, { compactCents: true })}`}
              </p>
            ))}
          </div>
        </details>
      )}
    </Sheet>
  )
}

function PayForm({
  group,
  accounts,
  defaultAccountId,
  onCancel,
  onError,
  onDone
}: {
  group: Group
  accounts: { id: string; name: string; type: string }[]
  defaultAccountId?: string
  onCancel: () => void
  onError: (m: string) => void
  onDone: () => void
}) {
  const initialAccount =
    accounts.find(a => a.id === defaultAccountId)?.id ?? accounts.find(a => a.type !== 'credit')?.id ?? accounts[0]?.id ?? ''
  const [amount, setAmount] = useState((group.remainingMinor / 100).toFixed(2))
  const [accountId, setAccountId] = useState(initialAccount)
  const [date, setDate] = useState(todayISO())

  async function save() {
    const minor = parseAmount(amount)
    if (!minor) return onError('Enter the amount received')
    if (minor > group.remainingMinor) return onError(`That's more than the ${fmt(group.remainingMinor, group.currency, { compactCents: true })} owed`)
    if (!accountId) return onError('Pick the account it landed in')
    onError('')
    // Pay off the oldest expenses first
    let left = minor
    for (const v of group.items) {
      if (left <= 0) break
      const take = Math.min(left, v.remainingMinor)
      await recordRepayment(v.r, take, accountId, date)
      left -= take
    }
    onDone()
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-full min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-900"
        />
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={e => setDate(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </div>
      <select
        value={accountId}
        onChange={e => setAccountId(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
      >
        {accounts.map(a => (
          <option key={a.id} value={a.id}>
            Into {a.name}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-400">Adds to the account balance only — it won't count as income.</p>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl bg-slate-200 py-2.5 text-sm font-semibold dark:bg-slate-700">
          Cancel
        </button>
        <button onClick={save} className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white">
          Save
        </button>
      </div>
    </div>
  )
}
