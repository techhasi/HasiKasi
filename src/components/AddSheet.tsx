import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, DEFAULT_SETTINGS, type Currency, type TxnType } from '../db/db'
import { parseAmount, CURRENCY_SYMBOL } from '../lib/money'
import { todayISO } from '../lib/dates'
import { compressImage } from '../lib/image'
import { startNewPeriod } from '../lib/periods'
import Sheet from './Sheet'

const CATEGORY_COLORS = ['#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#64748b']

export default function AddSheet({ onClose }: { onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])

  const [type, setType] = useState<TxnType>('expense')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [startsPeriod, setStartsPeriod] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // New-category mini form
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('✨')
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[5])

  const fileRef = useRef<HTMLInputElement>(null)

  const activeCurrency = currency ?? settings?.currency ?? 'LKR'
  const cats = useMemo(() => categories.filter(c => c.kind === type), [categories, type])
  const selectedCat = cats.find(c => c.id === categoryId)
  const effectiveAccountId = accountId ?? accounts[0]?.id ?? null
  const isSalary = type === 'income' && selectedCat?.name === 'Salary'

  async function addCategory() {
    const name = newCatName.trim()
    if (!name) return
    const id = uid()
    await db.categories.add({ id, name, emoji: newCatEmoji || '✨', color: newCatColor, kind: type })
    setCategoryId(id)
    setNewCatOpen(false)
    setNewCatName('')
  }

  async function save() {
    const amountMinor = parseAmount(amount)
    if (!amountMinor) return setError('Enter a valid amount')
    if (!categoryId || !cats.some(c => c.id === categoryId)) return setError('Pick a category')
    if (!effectiveAccountId) return setError('Pick an account')
    setError('')
    setSaving(true)
    try {
      const willStartPeriod = type === 'income' && isSalary && startsPeriod
      if (willStartPeriod) await startNewPeriod(date)

      const id = uid()
      await db.txns.add({
        id,
        type,
        amountMinor,
        currency: activeCurrency,
        categoryId,
        accountId: effectiveAccountId,
        date,
        note: note.trim(),
        startsPeriod: willStartPeriod || undefined,
        createdAt: Date.now()
      })
      if (type === 'expense' && receipt) {
        const blob = await compressImage(receipt)
        await db.receipts.add({ txnId: id, blob })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={onClose} title={null}>
      {/* Type toggle */}
      <div className="mb-5 flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
        {(['expense', 'income'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setType(t); setCategoryId(null); setReceipt(null) }}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold capitalize transition-all ${
              type === t
                ? t === 'expense'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                  : 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                : 'text-slate-500'
            }`}
          >
            {t === 'expense' ? '↑ Expense' : '↓ Income'}
          </button>
        ))}
      </div>

      {/* Amount */}
      <div className="mb-5 flex items-end justify-center gap-2">
        <button
          onClick={() => setCurrency(activeCurrency === 'LKR' ? 'USD' : 'LKR')}
          className="mb-2 rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
        >
          {CURRENCY_SYMBOL[activeCurrency]} {activeCurrency}
        </button>
        <input
          autoFocus
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-44 bg-transparent text-center text-5xl font-bold tabular-nums tracking-tight outline-none placeholder:text-slate-300 dark:placeholder:text-slate-700"
        />
      </div>

      {/* Category */}
      <Label>Category</Label>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {cats.map(c => (
          <button
            key={c.id}
            onClick={() => setCategoryId(c.id)}
            className={`flex flex-col items-center gap-1 rounded-2xl border-2 p-2 transition-all ${
              categoryId === c.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                : 'border-transparent bg-slate-50 dark:bg-slate-800/60'
            }`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl text-base" style={{ backgroundColor: `${c.color}22` }}>
              {c.emoji}
            </span>
            <span className="w-full truncate text-center text-[10px] font-medium">{c.name}</span>
          </button>
        ))}
        <button
          onClick={() => setNewCatOpen(o => !o)}
          className="flex flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 p-2 text-slate-400 dark:border-slate-600"
        >
          <span className="flex h-8 w-8 items-center justify-center text-lg">＋</span>
          <span className="text-[10px] font-medium">New</span>
        </button>
      </div>

      {newCatOpen && (
        <div className="mb-4 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="mb-2 flex gap-2">
            <input
              value={newCatEmoji}
              onChange={e => setNewCatEmoji(e.target.value.slice(-2))}
              className="w-12 rounded-xl border border-slate-200 bg-white p-2 text-center text-lg dark:border-slate-700 dark:bg-slate-900"
            />
            <input
              placeholder="Category name"
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CATEGORY_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewCatColor(c)}
                className={`h-6 w-6 rounded-full transition-transform ${newCatColor === c ? 'scale-125 ring-2 ring-slate-400 ring-offset-1' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button onClick={addCategory} className="w-full rounded-xl bg-indigo-500 py-2 text-sm font-semibold text-white">
            Add category
          </button>
        </div>
      )}

      {/* Date + Account */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <Label>Date</Label>
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={e => setDate(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
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

      {/* Note */}
      <Label>Note</Label>
      <input
        placeholder="Optional note…"
        value={note}
        onChange={e => setNote(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      {/* Receipt (expense only) */}
      {type === 'expense' && (
        <>
          <Label>Receipt</Label>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => setReceipt(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => fileRef.current?.click()}
            className="mb-4 flex w-full items-center gap-2 rounded-2xl border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-600"
          >
            📎 {receipt ? receipt.name : 'Attach a receipt photo'}
            {receipt && (
              <span
                onClick={e => { e.stopPropagation(); setReceipt(null); if (fileRef.current) fileRef.current.value = '' }}
                className="ml-auto text-rose-500"
              >
                ✕
              </span>
            )}
          </button>
        </>
      )}

      {/* Salary => new period */}
      {isSalary && (
        <label className="mb-4 flex items-center justify-between rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            🗓️ Start a new budget month from this date
          </span>
          <input type="checkbox" checked={startsPeriod} onChange={e => setStartsPeriod(e.target.checked)} className="h-5 w-5 accent-emerald-500" />
        </label>
      )}

      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className={`w-full rounded-2xl py-3.5 text-base font-bold text-white shadow-lg transition-transform active:scale-[0.98] disabled:opacity-50 ${
          type === 'expense'
            ? 'bg-gradient-to-r from-rose-500 to-orange-500 shadow-rose-500/30'
            : 'bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-500/30'
        }`}
      >
        {saving ? 'Saving…' : type === 'expense' ? 'Add Expense' : 'Add Income'}
      </button>
    </Sheet>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>
}
