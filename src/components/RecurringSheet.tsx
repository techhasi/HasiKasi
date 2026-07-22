import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, DEFAULT_SETTINGS, type Currency, type Recurring } from '../db/db'
import { parseAmount, CURRENCY_SYMBOL } from '../lib/money'
import { firstDue } from '../lib/recurring'
import Sheet from './Sheet'

const INTERVALS = [
  { months: 1, label: 'Monthly' },
  { months: 3, label: 'Quarterly' },
  { months: 6, label: 'Every 6 months' },
  { months: 12, label: 'Yearly' }
]

/** Add or edit a recurring payment (subscription/bill or loan). */
export default function RecurringSheet({ edit, onClose }: { edit?: Recurring; onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const categories = useLiveQuery(() => db.categories.where('kind').equals('expense').toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])

  const [name, setName] = useState(edit?.name ?? '')
  const [kind, setKind] = useState<Recurring['kind']>(edit?.kind ?? 'subscription')
  const [amount, setAmount] = useState(edit ? (edit.amountMinor / 100).toFixed(2) : '')
  const [currency, setCurrency] = useState<Currency>(edit?.currency ?? settings?.currency ?? 'LKR')
  const [categoryId, setCategoryId] = useState<string | null>(edit?.categoryId ?? null)
  const [accountId, setAccountId] = useState<string | null>(edit?.accountId ?? null)
  const [dayOfMonth, setDayOfMonth] = useState(edit ? String(edit.dayOfMonth) : '')
  const [intervalMonths, setIntervalMonths] = useState(edit?.intervalMonths ?? 1)
  const [note, setNote] = useState(edit?.note ?? '')
  const [principal, setPrincipal] = useState(edit?.principalMinor ? (edit.principalMinor / 100).toFixed(2) : '')
  const [paid, setPaid] = useState(edit?.paidMinor ? (edit.paidMinor / 100).toFixed(2) : '')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const effectiveCategoryId = categoryId ?? categories.find(c => c.name === 'Bills')?.id ?? categories[0]?.id ?? null
  const effectiveAccountId = accountId ?? accounts[0]?.id ?? null

  async function save() {
    const amountMinor = parseAmount(amount)
    const day = parseInt(dayOfMonth, 10)
    if (!name.trim()) return setError('Enter a name')
    if (!amountMinor) return setError('Enter a valid amount')
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError('Day must be 1–31')
    if (!effectiveCategoryId || !effectiveAccountId) return setError('Pick a category and account')

    let principalMinor: number | undefined
    let paidMinor: number | undefined
    if (kind === 'loan') {
      principalMinor = parseAmount(principal) ?? undefined
      if (!principalMinor) return setError('Enter the total loan amount')
      paidMinor = paid.trim() ? (parseAmount(paid) ?? 0) : (edit?.paidMinor ?? 0)
    }

    const fields = {
      name: name.trim(),
      kind,
      amountMinor,
      currency,
      categoryId: effectiveCategoryId,
      accountId: effectiveAccountId,
      dayOfMonth: day,
      intervalMonths,
      note: note.trim(),
      principalMinor,
      paidMinor
    }
    if (edit) {
      // Keep the existing schedule unless the day changed
      const nextDue = edit.dayOfMonth === day ? edit.nextDue : firstDue(day)
      await db.recurring.update(edit.id, { ...fields, nextDue })
    } else {
      await db.recurring.add({ id: uid(), ...fields, nextDue: firstDue(day), createdAt: Date.now() })
    }
    onClose()
  }

  async function remove() {
    if (edit) await db.recurring.delete(edit.id)
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={edit ? 'Edit recurring' : 'New recurring payment'}>
      {/* Kind toggle */}
      <div className="mb-4 flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
        {(['subscription', 'loan'] as const).map(k => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
              kind === k ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30' : 'text-slate-500'
            }`}
          >
            {k === 'subscription' ? '🔁 Subscription / Bill' : '🏦 Loan'}
          </button>
        ))}
      </div>

      <input
        autoFocus={!edit}
        placeholder={kind === 'loan' ? 'Loan name (e.g. Bike loan)' : 'Name (e.g. Netflix, Rent)'}
        value={name}
        onChange={e => setName(e.target.value)}
        className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label>{kind === 'loan' ? 'Installment' : 'Amount'}</Label>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrency(c => (c === 'LKR' ? 'USD' : 'LKR'))}
              className="shrink-0 rounded-lg bg-slate-100 px-2 py-2.5 text-xs font-bold text-slate-500 dark:bg-slate-800"
            >
              {CURRENCY_SYMBOL[currency]}
            </button>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800/60"
            />
          </div>
        </div>
        <div>
          <Label>Due day of month</Label>
          <input
            inputMode="numeric"
            placeholder="e.g. 5"
            value={dayOfMonth}
            onChange={e => setDayOfMonth(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800/60"
          />
        </div>
      </div>

      {kind === 'loan' && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <Label>Total loan amount</Label>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={principal}
              onChange={e => setPrincipal(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800/60"
            />
          </div>
          <div>
            <Label>Already paid</Label>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={paid}
              onChange={e => setPaid(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800/60"
            />
          </div>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <select
            value={effectiveCategoryId ?? ''}
            onChange={e => setCategoryId(e.target.value)}
            className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          >
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Account</Label>
          <select
            value={effectiveAccountId ?? ''}
            onChange={e => setAccountId(e.target.value)}
            className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Label>Repeats</Label>
      <div className="mb-3 flex gap-1.5">
        {INTERVALS.map(i => (
          <button
            key={i.months}
            onClick={() => setIntervalMonths(i.months)}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold ${
              intervalMonths === i.months
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      <input
        placeholder="Optional note…"
        value={note}
        onChange={e => setNote(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      <button onClick={save} className="mb-2 w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        {edit ? 'Save changes' : 'Add recurring payment'}
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

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>
}
