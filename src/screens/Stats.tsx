import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from 'recharts'
import { db, DEFAULT_SETTINGS, type Category, type CategoryKind, type Period, type Txn } from '../db/db'
import { txnsInPeriod } from '../lib/periods'
import { fmt, toLKR, spendMinor } from '../lib/money'
import { periodLabel, shortDate, todayISO } from '../lib/dates'
import { sortCats } from '../lib/categories'
import CategoryTxnsSheet from '../components/CategoryTxnsSheet'
import AiSheet from '../components/AiSheet'

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Sum of a kind's txns in a period (LKR), optionally for a single category. */
function periodTotal(txns: Txn[], p: Period, kind: CategoryKind, usdRate: number, categoryId: string) {
  let sum = 0
  for (const t of txnsInPeriod(txns, p)) {
    if (t.type !== kind || t.adjustment) continue
    if (categoryId && t.categoryId !== categoryId) continue
    sum += toLKR(spendMinor(t), t.currency, usdRate)
  }
  return sum
}

export default function Stats() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const periods = useLiveQuery(() => db.periods.orderBy('startDate').toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const [kind, setKind] = useState<CategoryKind>('expense')
  const [periodOffset, setPeriodOffset] = useState(0)
  const [selected, setSelected] = useState<Category | null>(null)
  const [trendCat, setTrendCat] = useState('')
  const [aiOpen, setAiOpen] = useState(false)

  const periodIdx = periods.length ? Math.max(0, periods.length - 1 - periodOffset) : -1
  const period = periodIdx >= 0 ? periods[periodIdx] : undefined
  const prevPeriod = periodIdx > 0 ? periods[periodIdx - 1] : undefined
  const usdRate = settings?.usdRate ?? 300

  const data = useMemo(() => {
    if (!period) return []
    const catById = new Map(categories.map(c => [c.id, c]))
    const byCat = new Map<string, number>()
    for (const t of txnsInPeriod(txns, period)) {
      if (t.type !== kind || t.adjustment) continue
      byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + toLKR(spendMinor(t), t.currency, usdRate))
    }
    return [...byCat.entries()]
      .map(([id, minor]) => {
        const c = catById.get(id)
        return {
          id,
          cat: c,
          name: c?.name ?? 'Unknown',
          emoji: c?.emoji ?? '❓',
          color: c?.color ?? '#64748b',
          budgetMinor: c?.budgetMinor,
          minor
        }
      })
      .sort((a, b) => b.minor - a.minor)
  }, [txns, period, kind, categories, usdRate])

  // Previous cycle's per-category totals, for the "vs last cycle" change
  const prevByCat = useMemo(() => {
    const m = new Map<string, number>()
    if (!prevPeriod) return m
    for (const t of txnsInPeriod(txns, prevPeriod)) {
      if (t.type !== kind || t.adjustment) continue
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + toLKR(spendMinor(t), t.currency, usdRate))
    }
    return m
  }, [txns, prevPeriod, kind, usdRate])

  // How far through an open cycle we are (0-1): open-ended, so use the typical past cycle length
  const elapsed = useMemo(() => {
    if (!period || period.endDate !== null) return null
    const past = periods.filter(p => p.endDate !== null)
    const avg = past.length ? past.reduce((s, p) => s + dayNum(p.endDate!) - dayNum(p.startDate) + 1, 0) / past.length : 30
    const days = dayNum(todayISO()) - dayNum(period.startDate) + 1
    return Math.min(1, Math.max(0, days / Math.max(1, avg)))
  }, [period, periods])

  // Last 6 cycles ending at the selected one
  const kindCats = useMemo(() => sortCats(categories.filter(c => c.kind === kind)), [categories, kind])
  const trend = useMemo(() => {
    if (periodIdx < 0) return []
    const cat = kindCats.some(c => c.id === trendCat) ? trendCat : ''
    const from = Math.max(0, periodIdx - 5)
    return periods.slice(from, periodIdx + 1).map((p, i) => ({
      idx: from + i,
      label: shortDate(p.startDate),
      minor: periodTotal(txns, p, kind, usdRate, cat)
    }))
  }, [periods, periodIdx, txns, kind, usdRate, trendCat, kindCats])

  const total = data.reduce((s, d) => s + d.minor, 0)

  return (
    <div className="px-4 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Statistics</h1>
        <button
          onClick={() => setAiOpen(true)}
          className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-3 py-1.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30"
        >
          ✨ AI
        </button>
      </div>

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
          {/* Trend across cycles */}
          <div className="mb-4 rounded-3xl bg-white p-4 shadow-sm dark:bg-slate-800/60">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Last {trend.length} cycles</p>
              <select
                value={trendCat}
                onChange={e => setTrendCat(e.target.value)}
                className="max-w-[10rem] truncate rounded-xl border border-slate-200 bg-slate-50 p-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">All categories</option>
                {kindCats.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip
                    cursor={false}
                    formatter={v => [fmt(Number(v), 'LKR', { compactCents: true }), kind === 'expense' ? 'Spent' : 'Earned']}
                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar
                    dataKey="minor"
                    radius={[6, 6, 0, 0]}
                    onClick={(_d, i) => trend[i] && setPeriodOffset(periods.length - 1 - trend[i].idx)}
                  >
                    {trend.map(t => (
                      <Cell
                        key={t.idx}
                        fill={kind === 'expense' ? '#f43f5e' : '#10b981'}
                        fillOpacity={t.idx === periodIdx ? 1 : 0.4}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center text-[10px] text-slate-400">Tap a bar to jump to that cycle</p>
          </div>

          <p className="mb-2 text-center text-xs text-slate-400">Tap a category to see its transactions</p>
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm dark:bg-slate-800/60">
            {data.map(d => {
              const pct = total ? Math.round((d.minor / total) * 100) : 0
              const budget = kind === 'expense' ? d.budgetMinor : undefined
              const usage = budget ? d.minor / budget : null
              const over = usage !== null && usage > 1
              const barPct = usage !== null ? Math.min(100, Math.round(usage * 100)) : pct
              const prev = prevByCat.get(d.id)
              const change = prev ? Math.round(((d.minor - prev) / prev) * 100) : null
              const goodWhenDown = kind === 'expense'
              const changeGood = change !== null && (goodWhenDown ? change <= 0 : change >= 0)
              const barColor = over ? '#ef4444' : usage !== null && usage > 0.85 ? '#f59e0b' : d.color
              return (
                <button
                  key={d.id}
                  onClick={() => d.cat && setSelected(d.cat)}
                  className="block w-full border-b border-slate-100 px-4 py-3 text-left last:border-0 active:bg-slate-50 dark:border-slate-700/50 dark:active:bg-slate-700/30"
                >
                  <div className="mb-1.5 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl text-base" style={{ backgroundColor: `${d.color}22` }}>
                      {d.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.name}</span>
                      {change !== null && (
                        <span className={`block text-xs ${change === 0 ? 'text-slate-400' : changeGood ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {change === 0 ? 'Same as last cycle' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}% vs last cycle`}
                        </span>
                      )}
                      {budget != null && (
                        <span className={`block text-xs ${over ? 'font-semibold text-rose-500' : 'text-slate-400'}`}>
                          {over
                            ? `${fmt(d.minor - budget, 'LKR', { compactCents: true })} over budget`
                            : `of ${fmt(budget, 'LKR', { compactCents: true })} budget`}
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{fmt(d.minor, 'LKR', { compactCents: true })}</span>
                    <span className="w-9 text-right text-xs text-slate-400">{usage !== null ? `${Math.round(usage * 100)}%` : `${pct}%`}</span>
                  </div>
                  <div className="relative ml-12 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: barColor }} />
                    {usage !== null && elapsed !== null && (
                      <span
                        title="Where you'd be if spending evenly through the cycle"
                        className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-slate-500 dark:bg-slate-300"
                        style={{ left: `${Math.round(elapsed * 100)}%` }}
                      />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {aiOpen && <AiSheet periodIdx={periodIdx} onClose={() => setAiOpen(false)} />}
      {selected && period && <CategoryTxnsSheet category={selected} period={period} onClose={() => setSelected(null)} />}
    </div>
  )
}
