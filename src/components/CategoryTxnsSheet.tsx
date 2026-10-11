import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Category, type Period, type Txn } from '../db/db'
import { txnsInPeriod } from '../lib/periods'
import { fmt, toLKR } from '../lib/money'
import { friendlyDate, periodLabel } from '../lib/dates'
import Sheet from './Sheet'
import TxnDetail from './TxnDetail'
import BudgetSheet from './BudgetSheet'

/** All transactions of one category within a budget period, newest first. */
export default function CategoryTxnsSheet({ category, period, onClose }: { category: Category; period: Period; onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const txns = useLiveQuery(() => db.txns.where('categoryId').equals(category.id).toArray(), [category.id], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const [detail, setDetail] = useState<Txn | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)

  const usdRate = settings?.usdRate ?? 300
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const list = useMemo(
    () =>
      txnsInPeriod(txns, period)
        .filter(t => t.type === category.kind && !t.adjustment)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [txns, period, category.kind]
  )
  const total = list.reduce((s, t) => s + toLKR(t.amountMinor, t.currency, usdRate), 0)
  const sign = category.kind === 'expense' ? '−' : '+'
  const tone = category.kind === 'expense' ? 'text-rose-500' : 'text-emerald-500'

  return (
    <Sheet onClose={onClose} title={null}>
      <div className="mb-4 flex flex-col items-center">
        <span className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl" style={{ backgroundColor: `${category.color}22` }}>
          {category.emoji}
        </span>
        <h2 className="text-lg font-bold">{category.name}</h2>
        <p className="text-xs text-slate-400">{periodLabel(period.startDate, period.endDate)}</p>
        <p className={`mt-1 text-3xl font-bold tabular-nums ${tone}`}>{fmt(total, 'LKR', { compactCents: true })}</p>
        <p className="text-xs text-slate-400">
          {list.length} transaction{list.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-800/60">
        {list.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No transactions in this period.</p>}
        {list.map(t => (
          <button
            key={t.id}
            onClick={() => setDetail(t)}
            className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 active:bg-slate-100 dark:border-slate-700/50 dark:active:bg-slate-700/30"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t.note || category.name}</span>
              <span className="block truncate text-xs text-slate-400">
                {friendlyDate(t.date)} · {accById.get(t.accountId)?.name ?? '—'}
              </span>
            </span>
            <span className={`text-sm font-semibold tabular-nums ${tone}`}>
              {sign}
              {fmt(t.amountMinor, t.currency, { compactCents: true })}
            </span>
          </button>
        ))}
      </div>

      {category.kind === 'expense' && (
        <button onClick={() => setBudgetOpen(true)} className="w-full rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">
          🎯 {category.budgetMinor != null ? 'Edit budget' : 'Set budget'}
        </button>
      )}

      {detail && <TxnDetail txn={detail} onClose={() => setDetail(null)} />}
      {budgetOpen && <BudgetSheet category={category} spentMinor={total} onClose={() => setBudgetOpen(false)} />}
    </Sheet>
  )
}
