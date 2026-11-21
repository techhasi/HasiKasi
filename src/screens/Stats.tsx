import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from 'recharts'
import { db, DEFAULT_SETTINGS, type Category, type CategoryKind, type Period, type Txn } from '../db/db'
import { txnsInPeriod } from '../lib/periods'
import { fmt, toLKR, spendMinor } from '../lib/money'
import { addDaysISO, friendlyDate, periodLabel, shortDate, todayISO } from '../lib/dates'
import CategoryTxnsSheet from '../components/CategoryTxnsSheet'
import TxnDetail from '../components/TxnDetail'
import AiSheet from '../components/AiSheet'

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

type SortKey = 'amount' | 'change' | 'budget'

/** Counted amount of a txn for this view (LKR): my share of expenses, skipping transfers/adjustments. */
function counted(t: Txn, kind: CategoryKind, usdRate: number): number | null {
  if (t.type !== kind || t.adjustment) return null
  return toLKR(spendMinor(t), t.currency, usdRate)
}

/** Sum of a kind's txns in a period (LKR), optionally for a single category. */
function periodTotal(txns: Txn[], p: Period, kind: CategoryKind, usdRate: number, categoryId: string | null) {
  let sum = 0
  for (const t of txnsInPeriod(txns, p)) {
    const v = counted(t, kind, usdRate)
    if (v === null || (categoryId && t.categoryId !== categoryId)) continue
    sum += v
  }
  return sum
}

// ── donut geometry ──
const R = 76
const CIRC = 2 * Math.PI * R

export default function Stats() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const periods = useLiveQuery(() => db.periods.orderBy('startDate').toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const [kind, setKind] = useState<CategoryKind>('expense')
  const [periodOffset, setPeriodOffset] = useState(0)
  const [sheetCat, setSheetCat] = useState<Category | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('amount')
  const [detail, setDetail] = useState<Txn | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  const periodIdx = periods.length ? Math.max(0, periods.length - 1 - periodOffset) : -1
  const period = periodIdx >= 0 ? periods[periodIdx] : undefined
  const prevPeriod = periodIdx > 0 ? periods[periodIdx - 1] : undefined
  const usdRate = settings?.usdRate ?? 300

  function goOlder() {
    setPeriodOffset(o => Math.min(o + 1, periods.length - 1))
    setSelectedDay(null)
  }
  function goNewer() {
    setPeriodOffset(o => Math.max(o - 1, 0))
    setSelectedDay(null)
  }
  function changeKind(k: CategoryKind) {
    setKind(k)
    setSelectedId(null)
    setSelectedDay(null)
    if (k === 'income') setSort(s => (s === 'budget' ? 'amount' : s))
  }

  // Swipe the page sideways to move between cycles
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current
    touch.current = null
    if (!s) return
    const dx = e.changedTouches[0].clientX - s.x
    const dy = e.changedTouches[0].clientY - s.y
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45) (dx > 0 ? goOlder : goNewer)()
  }

  const periodTxns = useMemo(() => (period ? txnsInPeriod(txns, period) : []), [txns, period])

  const data = useMemo(() => {
    const catById = new Map(categories.map(c => [c.id, c]))
    const byCat = new Map<string, { minor: number; count: number; max: number }>()
    for (const t of periodTxns) {
      const v = counted(t, kind, usdRate)
      if (v === null) continue
      const e = byCat.get(t.categoryId) ?? { minor: 0, count: 0, max: 0 }
      e.minor += v
      e.count += 1
      e.max = Math.max(e.max, v)
      byCat.set(t.categoryId, e)
    }
    return [...byCat.entries()].map(([id, e]) => {
      const c = catById.get(id)
      return {
        id,
        cat: c,
        name: c?.name ?? 'Unknown',
        emoji: c?.emoji ?? '❓',
        color: c?.color ?? '#64748b',
        budgetMinor: c?.budgetMinor,
        minor: e.minor,
        count: e.count,
        max: e.max
      }
    })
  }, [periodTxns, kind, categories, usdRate])

  // Previous cycle's per-category totals, for the "vs last cycle" change
  const prevByCat = useMemo(() => {
    const m = new Map<string, number>()
    if (!prevPeriod) return m
    for (const t of txnsInPeriod(txns, prevPeriod)) {
      const v = counted(t, kind, usdRate)
      if (v !== null) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + v)
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

  const total = data.reduce((s, d) => s + d.minor, 0)
  const rows = useMemo(() => {
    const withMeta = data.map(d => {
      const prev = prevByCat.get(d.id)
      const change = prev ? Math.round(((d.minor - prev) / prev) * 100) : null
      const usage = kind === 'expense' && d.budgetMinor ? d.minor / d.budgetMinor : null
      return { ...d, change, usage }
    })
    const key = (r: (typeof withMeta)[number]) => (sort === 'change' ? r.change : sort === 'budget' ? r.usage : r.minor)
    return withMeta.sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      if (ka === null && kb === null) return b.minor - a.minor
      if (ka === null) return 1
      if (kb === null) return -1
      return kb - ka
    })
  }, [data, prevByCat, kind, sort])

  const selected = rows.find(r => r.id === selectedId) ?? null
  const activeCat = selected ? selected.id : null

  // Donut segments (ordered by amount so slices stay stable while the list is re-sorted)
  const segments = useMemo(() => {
    const ordered = [...data].sort((a, b) => b.minor - a.minor)
    let start = 0
    const gap = ordered.length > 1 ? 2.2 : 0
    return ordered.map(d => {
      const len = total ? (d.minor / total) * CIRC : 0
      const seg = { id: d.id, color: d.color, dash: Math.max(0.5, len - gap), offset: -start }
      start += len
      return seg
    })
  }, [data, total])

  // Last 6 cycles ending at the selected one (filtered by the selected category)
  const trend = useMemo(() => {
    if (periodIdx < 0) return []
    const from = Math.max(0, periodIdx - 5)
    return periods.slice(from, periodIdx + 1).map((p, i) => ({
      idx: from + i,
      label: shortDate(p.startDate),
      minor: periodTotal(txns, p, kind, usdRate, activeCat)
    }))
  }, [periods, periodIdx, txns, kind, usdRate, activeCat])

  // Day-by-day within the selected cycle (also filtered by the selected category)
  const daily = useMemo(() => {
    if (!period) return []
    const end = period.endDate ?? todayISO()
    const byDay = new Map<string, number>()
    for (const t of periodTxns) {
      const v = counted(t, kind, usdRate)
      if (v === null || (activeCat && t.categoryId !== activeCat)) continue
      byDay.set(t.date, (byDay.get(t.date) ?? 0) + v)
    }
    const out: { date: string; label: string; minor: number }[] = []
    const days = Math.min(70, Math.max(0, dayNum(end) - dayNum(period.startDate)) + 1)
    for (let i = 0; i < days; i++) {
      const date = addDaysISO(period.startDate, i)
      out.push({ date, label: String(Number(date.slice(8))), minor: byDay.get(date) ?? 0 })
    }
    return out
  }, [period, periodTxns, kind, usdRate, activeCat])

  const dayTxns = useMemo(() => {
    if (!selectedDay) return []
    return periodTxns
      .filter(t => t.date === selectedDay && counted(t, kind, usdRate) !== null && (!activeCat || t.categoryId === activeCat))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [periodTxns, selectedDay, kind, usdRate, activeCat])
  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const avgPerDay = daily.length ? daily.reduce((s, d) => s + d.minor, 0) / daily.length : 0
  const accent = kind === 'expense' ? '#f43f5e' : '#10b981'

  return (
    <div className="px-4 pt-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Statistics</h1>
        <button
          onClick={() => setAiOpen(true)}
          className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-3 py-1.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25"
        >
          ✨ AI
        </button>
      </div>

      {/* Period picker */}
      <div className="card mb-4 flex items-center justify-between rounded-2xl bg-white p-2 dark:bg-slate-800/60">
        <button
          onClick={goOlder}
          disabled={periodOffset >= periods.length - 1}
          aria-label="Older cycle"
          className="rounded-xl bg-slate-100 px-3.5 py-1.5 text-sm disabled:opacity-30 dark:bg-slate-700"
        >
          ‹
        </button>
        <button onClick={() => periodOffset !== 0 && (setPeriodOffset(0), setSelectedDay(null))} className="text-center">
          <span className="block text-sm font-semibold">{period ? periodLabel(period.startDate, period.endDate) : '—'}</span>
          <span className="block text-[10px] text-slate-400">
            {periodOffset === 0 ? 'Current cycle · swipe to browse' : 'Tap to jump to current'}
          </span>
        </button>
        <button
          onClick={goNewer}
          disabled={periodOffset === 0}
          aria-label="Newer cycle"
          className="rounded-xl bg-slate-100 px-3.5 py-1.5 text-sm disabled:opacity-30 dark:bg-slate-700"
        >
          ›
        </button>
      </div>

      {/* Kind toggle */}
      <div className="mb-4 flex rounded-2xl bg-slate-200/60 p-1 dark:bg-slate-800">
        {(['expense', 'income'] as const).map(k => (
          <button
            key={k}
            onClick={() => changeKind(k)}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold capitalize transition-all ${
              kind === k ? (k === 'expense' ? 'bg-rose-500 text-white shadow' : 'bg-emerald-500 text-white shadow') : 'text-slate-500'
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
          {/* Donut — tap a slice to focus a category; charts below follow the selection */}
          <div className="card relative mb-4 rounded-3xl bg-white p-4 dark:bg-slate-800/60">
            <div className="relative mx-auto aspect-square w-full max-w-[15rem]">
              <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
                <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor" strokeWidth="22" className="text-slate-100 dark:text-slate-700/50" />
                {segments.map(sg => {
                  const isSel = sg.id === selectedId
                  return (
                    <circle
                      key={sg.id}
                      className="donut-seg"
                      cx="100"
                      cy="100"
                      r={R}
                      fill="none"
                      stroke={sg.color}
                      strokeWidth={isSel ? 30 : 22}
                      strokeDasharray={`${sg.dash} ${CIRC - sg.dash}`}
                      strokeDashoffset={sg.offset}
                      opacity={selectedId && !isSel ? 0.28 : 1}
                      onClick={() => {
                        setSelectedId(isSel ? null : sg.id)
                        setSelectedDay(null)
                      }}
                    />
                  )
                })}
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
                {selected ? (
                  <>
                    <p className="text-2xl leading-none">{selected.emoji}</p>
                    <p className="mt-1 max-w-full truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{selected.name}</p>
                    <p className="text-xl font-bold tabular-nums">{fmt(selected.minor, 'LKR', { compactCents: true })}</p>
                    <p className="text-[11px] text-slate-400">{total ? Math.round((selected.minor / total) * 100) : 0}% of total</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs uppercase tracking-widest text-slate-400">Total</p>
                    <p className="text-xl font-bold tabular-nums">{fmt(total, 'LKR', { compactCents: true })}</p>
                    <p className="text-[11px] text-slate-400">tap a slice</p>
                  </>
                )}
              </div>
            </div>

            {selected && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  onClick={() => selected.cat && setSheetCat(selected.cat)}
                  className="rounded-full bg-indigo-500 px-3.5 py-1.5 text-xs font-semibold text-white"
                >
                  See {selected.count} transaction{selected.count === 1 ? '' : 's'} ›
                </button>
                <button onClick={() => setSelectedId(null)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Daily pattern within the cycle */}
          <div className="card mb-4 rounded-3xl bg-white p-4 dark:bg-slate-800/60">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                Day by day{selected ? <span className="text-slate-400"> · {selected.name}</span> : null}
              </p>
              <p className="text-[11px] text-slate-400">avg {fmt(Math.round(avgPerDay / 100) * 100, 'LKR', { compactCents: true })}/day</p>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 6, right: 0, left: 0, bottom: 0 }} barCategoryGap="18%">
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval={Math.max(0, Math.ceil(daily.length / 8) - 1)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                  />
                  <Tooltip cursor={false} content={() => null} />
                  <Bar dataKey="minor" radius={[3, 3, 0, 0]} onClick={(_d, i) => daily[i] && setSelectedDay(d => (d === daily[i].date ? null : daily[i].date))}>
                    {daily.map(d => (
                      <Cell
                        key={d.date}
                        fill={accent}
                        fillOpacity={selectedDay ? (d.date === selectedDay ? 1 : 0.3) : 0.85}
                        style={{ cursor: 'pointer', transition: 'fill-opacity 0.2s' }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {selectedDay ? (
              <div className="mt-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-900/40">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-xs font-semibold">
                    {friendlyDate(selectedDay)} ·{' '}
                    <span className="tabular-nums">{fmt(daily.find(d => d.date === selectedDay)?.minor ?? 0, 'LKR', { compactCents: true })}</span>
                  </p>
                  <button onClick={() => setSelectedDay(null)} className="text-[11px] font-semibold text-slate-400">
                    Close
                  </button>
                </div>
                {dayTxns.length === 0 ? (
                  <p className="text-xs text-slate-400">Nothing {kind === 'expense' ? 'spent' : 'earned'} this day.</p>
                ) : (
                  dayTxns.map(t => {
                    const c = catById.get(t.categoryId)
                    return (
                      <button key={t.id} onClick={() => setDetail(t)} className="flex w-full items-center gap-2 py-1.5 text-left">
                        <span className="text-base">{c?.emoji ?? '❓'}</span>
                        <span className="min-w-0 flex-1 truncate text-xs">{t.note || c?.name || 'Unknown'}</span>
                        <span className="text-xs font-semibold tabular-nums">{fmt(spendMinor(t), t.currency, { compactCents: true })}</span>
                      </button>
                    )
                  })
                )}
              </div>
            ) : (
              <p className="mt-1 text-center text-[10px] text-slate-400">Tap a bar to see that day</p>
            )}
          </div>

          {/* Trend across cycles (needs at least two cycles to say anything) */}
          {trend.length > 1 && (
          <div className="card mb-4 rounded-3xl bg-white p-4 dark:bg-slate-800/60">
            <p className="mb-2 text-sm font-semibold">
              Last {trend.length} cycles{selected ? <span className="text-slate-400"> · {selected.name}</span> : null}
            </p>
            <div className="h-32">
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
                    onClick={(_d, i) => {
                      if (!trend[i]) return
                      setPeriodOffset(periods.length - 1 - trend[i].idx)
                      setSelectedDay(null)
                    }}
                  >
                    {trend.map(t => (
                      <Cell key={t.idx} fill={accent} fillOpacity={t.idx === periodIdx ? 1 : 0.4} style={{ cursor: 'pointer' }} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center text-[10px] text-slate-400">Tap a bar to jump to that cycle</p>
          </div>
          )}

          {/* Category list: tap to focus / expand */}
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Categories</p>
            <div className="flex gap-1 rounded-full bg-slate-200/60 p-0.5 text-[11px] font-semibold dark:bg-slate-800">
              {(
                [
                  ['amount', 'Amount'],
                  ['change', 'Change'],
                  ...(kind === 'expense' ? ([['budget', 'Budget']] as const) : [])
                ] as [SortKey, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`rounded-full px-2.5 py-1 ${sort === k ? 'bg-white shadow-sm dark:bg-slate-600' : 'text-slate-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="card overflow-hidden rounded-3xl bg-white dark:bg-slate-800/60">
            {rows.map(d => {
              const pct = total ? Math.round((d.minor / total) * 100) : 0
              const budget = kind === 'expense' ? d.budgetMinor : undefined
              const usage = d.usage
              const over = usage !== null && usage > 1
              const barPct = usage !== null ? Math.min(100, Math.round(usage * 100)) : pct
              const goodWhenDown = kind === 'expense'
              const changeGood = d.change !== null && (goodWhenDown ? d.change <= 0 : d.change >= 0)
              const barColor = over ? '#ef4444' : usage !== null && usage > 0.85 ? '#f59e0b' : d.color
              const isSel = d.id === selectedId
              return (
                <div
                  key={d.id}
                  className={`border-b border-slate-100 transition-colors last:border-0 dark:border-slate-700/50 ${isSel ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : ''}`}
                >
                  <button
                    onClick={() => {
                      setSelectedId(isSel ? null : d.id)
                      setSelectedDay(null)
                    }}
                    className="block w-full px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/30"
                  >
                    <div className="mb-1.5 flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl text-base" style={{ backgroundColor: `${d.color}22` }}>
                        {d.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        {d.change !== null && (
                          <span className={`block text-xs ${d.change === 0 ? 'text-slate-400' : changeGood ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {d.change === 0 ? 'Same as last cycle' : `${d.change > 0 ? '▲' : '▼'} ${Math.abs(d.change)}% vs last cycle`}
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
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barPct}%`, backgroundColor: barColor }} />
                      {usage !== null && elapsed !== null && (
                        <span
                          title="Where you'd be if spending evenly through the cycle"
                          className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-slate-500 dark:bg-slate-300"
                          style={{ left: `${Math.round(elapsed * 100)}%` }}
                        />
                      )}
                    </div>
                  </button>

                  {isSel && (
                    <div className="px-4 pb-3 pl-16">
                      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
                        <MiniStat label="Transactions" value={String(d.count)} />
                        <MiniStat label="Average" value={fmt(Math.round(d.minor / d.count / 100) * 100, 'LKR', { compactCents: true })} />
                        <MiniStat label="Biggest" value={fmt(d.max, 'LKR', { compactCents: true })} />
                      </div>
                      <button
                        onClick={() => d.cat && setSheetCat(d.cat)}
                        className="w-full rounded-xl bg-indigo-500 py-2 text-xs font-semibold text-white"
                      >
                        See transactions{kind === 'expense' ? ' & set budget' : ''} ›
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {aiOpen && <AiSheet periodIdx={periodIdx} onClose={() => setAiOpen(false)} />}
      {sheetCat && period && <CategoryTxnsSheet category={sheetCat} period={period} onClose={() => setSheetCat(null)} />}
      {detail && <TxnDetail txn={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/70 px-1 py-1.5 dark:bg-slate-900/40">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-xs font-bold tabular-nums">{value}</p>
    </div>
  )
}
