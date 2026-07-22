import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { db, DEFAULT_SETTINGS, type TxnType } from '../db/db'
import { txnsInPeriod } from '../lib/periods'
import { fmt, toLKR } from '../lib/money'
import { periodLabel } from '../lib/dates'

export default function Stats() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const periods = useLiveQuery(() => db.periods.orderBy('startDate').toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const [kind, setKind] = useState<TxnType>('expense')
  const [periodOffset, setPeriodOffset] = useState(0)

  const period = periods.length ? periods[Math.max(0, periods.length - 1 - periodOffset)] : undefined
  const usdRate = settings?.usdRate ?? 300

  const data = useMemo(() => {
    if (!period) return []
    const catById = new Map(categories.map(c => [c.id, c]))
    const byCat = new Map<string, number>()
    for (const t of txnsInPeriod(txns, period)) {
      if (t.type !== kind) continue
      byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + toLKR(t.amountMinor, t.currency, usdRate))
    }
    return [...byCat.entries()]
      .map(([id, minor]) => {
        const c = catById.get(id)
        return { name: c?.name ?? 'Unknown', emoji: c?.emoji ?? '❓', color: c?.color ?? '#64748b', minor }
      })
      .sort((a, b) => b.minor - a.minor)
  }, [txns, period, kind, categories, usdRate])

  const total = data.reduce((s, d) => s + d.minor, 0)

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Statistics</h1>

      {/* Period picker */}
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-2 shadow-sm dark:bg-slate-800/60">
        <button
          onClick={() => setPeriodOffset(o => Math.min(o + 1, periods.length - 1))}
          disabled={periodOffset >= periods.length - 1}
          className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm disabled:opacity-30 dark:bg-slate-700"
        >
          ‹
        </button>
        <p className="text-sm font-semibold">{period ? periodLabel(period.startDate, period.endDate) : '—'}</p>
        <button
          onClick={() => setPeriodOffset(o => Math.max(o - 1, 0))}
          disabled={periodOffset === 0}
          className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm disabled:opacity-30 dark:bg-slate-700"
        >
          ›
        </button>
      </div>

      {/* Kind toggle */}
      <div className="mb-4 flex rounded-2xl bg-slate-200/60 p-1 dark:bg-slate-800">
        {(['expense', 'income'] as const).map(k => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold capitalize transition-all ${
              kind === k
                ? k === 'expense'
                  ? 'bg-rose-500 text-white shadow'
                  : 'bg-emerald-500 text-white shadow'
                : 'text-slate-500'
            }`}
          >
            {k === 'expense' ? 'Spending' : 'Income'}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-slate-400 dark:border-slate-700">
          <p className="mb-1 text-3xl">📊</p>
          <p className="text-sm">No {kind === 'expense' ? 'spending' : 'income'} in this period yet.</p>
        </div>
      ) : (
        <>
          {/* Donut */}
          <div className="relative mb-4 rounded-3xl bg-white p-4 shadow-sm dark:bg-slate-800/60">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="minor" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={3} strokeWidth={0}>
                    {data.map(d => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-xs uppercase tracking-widest text-slate-400">Total</p>
              <p className="text-xl font-bold tabular-nums">{fmt(total, 'LKR', { compactCents: true })}</p>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm dark:bg-slate-800/60">
            {data.map(d => {
              const pct = total ? Math.round((d.minor / total) * 100) : 0
              return (
                <div key={d.name} className="border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-700/50">
                  <div className="mb-1.5 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl text-base" style={{ backgroundColor: `${d.color}22` }}>
                      {d.emoji}
                    </span>
                    <span className="flex-1 text-sm font-medium">{d.name}</span>
                    <span className="text-sm font-semibold tabular-nums">{fmt(d.minor, 'LKR', { compactCents: true })}</span>
                    <span className="w-9 text-right text-xs text-slate-400">{pct}%</span>
                  </div>
                  <div className="ml-12 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
