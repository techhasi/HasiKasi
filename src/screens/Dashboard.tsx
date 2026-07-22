import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Txn } from '../db/db'
import { computeTotals, txnsInPeriod } from '../lib/periods'
import { fmt, toLKR } from '../lib/money'
import { friendlyDate, periodLabel } from '../lib/dates'
import TxnDetail from '../components/TxnDetail'
import SmsImport from '../components/SmsImport'
import SearchSheet from '../components/SearchSheet'

export default function Dashboard() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const periods = useLiveQuery(() => db.periods.orderBy('startDate').toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const pendingCount = useLiveQuery(() => db.pending.count(), [], 0)

  // Period navigation: index into periods array, default = active (last)
  const [periodOffset, setPeriodOffset] = useState(0) // 0 = latest
  const [detail, setDetail] = useState<Txn | null>(null)
  const [smsOpen, setSmsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const period = periods.length ? periods[Math.max(0, periods.length - 1 - periodOffset)] : undefined

  const totals = useMemo(
    () => (period ? computeTotals(txns, period, settings?.usdRate ?? 300) : null),
    [txns, period, settings?.usdRate]
  )

  // Budget progress for the displayed period (all budgeted categories, even with no spending)
  const budgets = useMemo(() => {
    if (!period) return []
    const spent = new Map<string, number>()
    for (const t of txnsInPeriod(txns, period)) {
      if (t.type !== 'expense') continue
      spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + toLKR(t.amountMinor, t.currency, settings?.usdRate ?? 300))
    }
    return categories
      .filter(c => c.kind === 'expense' && c.budgetMinor != null)
      .map(c => ({ cat: c, spent: spent.get(c.id) ?? 0, budget: c.budgetMinor! }))
      .sort((a, b) => b.spent / b.budget - a.spent / a.budget)
  }, [txns, period, categories, settings?.usdRate])

  const grouped = useMemo(() => {
    if (!period) return []
    const inPeriod = txnsInPeriod(txns, period).sort(
      (a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date))
    )
    const groups: { date: string; items: Txn[] }[] = []
    for (const t of inPeriod) {
      const g = groups[groups.length - 1]
      if (g && g.date === t.date) g.items.push(t)
      else groups.push({ date: t.date, items: [t] })
    }
    return groups
  }, [txns, period])

  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])

  return (
    <div className="px-4 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">My Budget</p>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        </div>
        <div className="flex gap-2">
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search transactions"
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-xl shadow-sm dark:bg-slate-800/60"
        >
          🔍
        </button>
        <button
          onClick={() => setSmsOpen(true)}
          aria-label="Import from SMS"
          className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-xl shadow-sm dark:bg-slate-800/60"
        >
          📥
          {pendingCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
        </div>
      </header>

      {/* Summary card */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 p-5 text-white shadow-xl shadow-indigo-500/30">
        <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -right-16 top-8 h-40 w-40 rounded-full bg-white/5" />

        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => setPeriodOffset(o => Math.min(o + 1, periods.length - 1))}
            disabled={periodOffset >= periods.length - 1}
            className="rounded-full bg-white/15 px-2.5 py-1 text-sm disabled:opacity-30"
          >
            ‹
          </button>
          <p className="text-sm font-medium text-indigo-100">
            {period ? periodLabel(period.startDate, period.endDate) : '—'}
            {periodOffset === 0 && <span className="ml-1.5 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">CURRENT</span>}
          </p>
          <button
            onClick={() => setPeriodOffset(o => Math.max(o - 1, 0))}
            disabled={periodOffset === 0}
            className="rounded-full bg-white/15 px-2.5 py-1 text-sm disabled:opacity-30"
          >
            ›
          </button>
        </div>

        <p className="text-center text-xs uppercase tracking-widest text-indigo-200">Balance</p>
        <p className="mb-4 text-center text-4xl font-bold tabular-nums tracking-tight">
          {totals ? fmt(totals.balanceMinor, 'LKR', { compactCents: true }) : '—'}
        </p>

        <div className="flex gap-3">
          <div className="flex-1 rounded-2xl bg-white/12 p-3 backdrop-blur">
            <p className="text-xs text-indigo-100">↓ Earning</p>
            <p className="text-lg font-semibold tabular-nums text-emerald-300">
              {totals ? fmt(totals.earningMinor, 'LKR', { compactCents: true }) : '—'}
            </p>
          </div>
          <div className="flex-1 rounded-2xl bg-white/12 p-3 backdrop-blur">
            <p className="text-xs text-indigo-100">↑ Spending</p>
            <p className="text-lg font-semibold tabular-nums text-rose-300">
              {totals ? fmt(totals.spendingMinor, 'LKR', { compactCents: true }) : '—'}
            </p>
          </div>
        </div>

        {totals != null && totals.carryInMinor !== 0 && (
          <p className="mt-3 text-center text-xs text-indigo-200">
            includes {fmt(totals.carryInMinor, 'LKR', { compactCents: true })} carried over
          </p>
        )}
      </section>

      {/* Budgets */}
      {budgets.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Budgets
          </h2>
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-800/60">
            {budgets.map(({ cat, spent, budget }) => {
              const usage = spent / budget
              const over = usage > 1
              const barColor = over ? '#ef4444' : usage > 0.85 ? '#f59e0b' : cat.color
              return (
                <div key={cat.id} className="border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-700/50">
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl text-sm" style={{ backgroundColor: `${cat.color}22` }}>
                      {cat.emoji}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium">{cat.name}</span>
                    <span className={`text-xs font-semibold tabular-nums ${over ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
                      {fmt(spent, 'LKR', { compactCents: true })}
                      <span className="font-normal text-slate-400"> / {fmt(budget, 'LKR', { compactCents: true })}</span>
                    </span>
                  </div>
                  <div className="ml-[42px] h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.round(usage * 100))}%`, backgroundColor: barColor }}
                    />
                  </div>
                  {over && (
                    <p className="ml-[42px] mt-1 text-[11px] font-semibold text-rose-500">
                      {fmt(spent - budget, 'LKR', { compactCents: true })} over
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Transactions */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Transactions
        </h2>

        {grouped.length === 0 && (
          <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-slate-400 dark:border-slate-700">
            <p className="mb-1 text-3xl">🌱</p>
            <p className="text-sm">No transactions this period yet.</p>
            <p className="text-xs">Tap + to add your first one.</p>
          </div>
        )}

        {grouped.map(g => (
          <div key={g.date} className="mb-4">
            <p className="mb-1.5 px-1 text-xs font-semibold text-slate-400 dark:text-slate-500">{friendlyDate(g.date)}</p>
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-800/60">
              {g.items.map(t => {
                const isTransfer = t.type === 'transfer'
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
                      style={{ backgroundColor: isTransfer ? '#0ea5e922' : `${cat?.color ?? '#64748b'}22` }}
                    >
                      {isTransfer ? '⇄' : (cat?.emoji ?? '❓')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{isTransfer ? 'Transfer' : (cat?.name ?? 'Unknown')}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {isTransfer ? `${acc?.name} → ${toAcc?.name}` : acc?.name}
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
            </div>
          </div>
        ))}
      </section>

      {detail && <TxnDetail txn={detail} onClose={() => setDetail(null)} />}
      {smsOpen && <SmsImport onClose={() => setSmsOpen(false)} />}
      {searchOpen && <SearchSheet onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
