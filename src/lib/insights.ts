import type { Category, Period, Receivable, Recurring, Txn } from '../db/db'
import { outstandingLKR } from './receivables'
import { txnsInPeriod } from './periods'
import { toLKR, spendMinor } from './money'
import { periodLabel, todayISO } from './dates'

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}
const rs = (minor: number) => Math.round(minor / 100)
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null)

export interface CategoryFact {
  name: string
  spentRs: number
  /** previous cycle, same category */
  prevCycleRs: number
  changeVsPrevPct: number | null
  /** average of up to 3 earlier cycles */
  avgEarlierRs: number
  budgetRs: number | null
  budgetUsedPct: number | null
  /** open cycle only: spent / fraction of cycle elapsed */
  projectedRs: number | null
  sharePct: number
}

export interface Facts {
  cycle: string
  open: boolean
  dayOfCycle: number
  typicalCycleDays: number
  incomeRs: number
  spendingRs: number
  prevCycleSpendingRs: number | null
  savingsRatePct: number | null
  /** open cycle only */
  projectedSpendingRs: number | null
  categories: CategoryFact[]
  /** unusually large expenses this cycle (no notes/merchants included) */
  unusualExpenses: { category: string; amountRs: number; date: string; typicalRs: number }[]
  recurring: { name: string; kind: string; amountRs: number }[]
  /** money friends still owe me for shared expenses; NOT part of spending (spending already excludes it) */
  friendsOweMeRs: number
  /** how many earlier cycles exist for comparison (max 4) */
  cyclesCompared: number
}

/** Deterministic numbers the model narrates — computed locally so it never has to do the maths. */
export function computeFacts(o: {
  periods: Period[]
  periodIdx: number
  txns: Txn[]
  categories: Category[]
  recurring: Recurring[]
  receivables?: Receivable[]
  usdRate: number
}): Facts | null {
  const { periods, periodIdx, txns, categories, recurring, usdRate } = o
  const p = periods[periodIdx]
  if (!p) return null
  const catName = new Map(categories.map(c => [c.id, c.name]))
  const budgets = new Map(categories.filter(c => c.budgetMinor != null).map(c => [c.id, c.budgetMinor!]))

  const summarize = (per: Period) => {
    const byCat = new Map<string, number>()
    let income = 0
    let spending = 0
    for (const t of txnsInPeriod(txns, per)) {
      if (t.type === 'transfer' || t.adjustment) continue
      const lkr = toLKR(spendMinor(t), t.currency, usdRate)
      if (t.type === 'income') income += lkr
      else {
        spending += lkr
        byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + lkr)
      }
    }
    return { byCat, income, spending }
  }

  const cur = summarize(p)
  const prev = periodIdx > 0 ? summarize(periods[periodIdx - 1]) : null
  const earlier = periods.slice(Math.max(0, periodIdx - 3), periodIdx).map(summarize)

  const open = p.endDate === null
  const completed = periods.filter(x => x.endDate !== null)
  const typical = completed.length
    ? Math.round(completed.reduce((s, x) => s + dayNum(x.endDate!) - dayNum(x.startDate) + 1, 0) / completed.length)
    : 30
  const dayOfCycle = open ? Math.max(1, dayNum(todayISO()) - dayNum(p.startDate) + 1) : Math.round(dayNum(p.endDate!) - dayNum(p.startDate) + 1)
  const elapsed = open ? Math.min(1, dayOfCycle / Math.max(1, typical)) : 1
  // Early in a cycle the run-rate is too noisy to project
  const canProject = open && elapsed >= 0.15

  const cats: CategoryFact[] = [...cur.byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, spent]) => {
      const prevSpent = prev?.byCat.get(id) ?? 0
      const avg = earlier.length ? earlier.reduce((s, e) => s + (e.byCat.get(id) ?? 0), 0) / earlier.length : 0
      const budget = budgets.get(id) ?? null
      return {
        name: catName.get(id) ?? 'Unknown',
        spentRs: rs(spent),
        prevCycleRs: rs(prevSpent),
        changeVsPrevPct: pct(spent, prevSpent),
        avgEarlierRs: rs(avg),
        budgetRs: budget != null ? rs(budget) : null,
        budgetUsedPct: budget ? Math.round((spent / budget) * 100) : null,
        projectedRs: canProject ? rs(spent / elapsed) : null,
        sharePct: cur.spending ? Math.round((spent / cur.spending) * 100) : 0
      }
    })

  // Unusual expenses: ≥2.5× the category's typical expense in earlier cycles (needs ≥3 earlier samples)
  const history = new Map<string, number[]>()
  for (const per of periods.slice(0, periodIdx)) {
    for (const t of txnsInPeriod(txns, per)) {
      if (t.type !== 'expense' || t.adjustment) continue
      const arr = history.get(t.categoryId) ?? []
      arr.push(toLKR(spendMinor(t), t.currency, usdRate))
      history.set(t.categoryId, arr)
    }
  }
  const unusual = txnsInPeriod(txns, p)
    .filter(t => t.type === 'expense' && !t.adjustment)
    .map(t => {
      const h = history.get(t.categoryId) ?? []
      const typical = h.length >= 3 ? h.reduce((s, x) => s + x, 0) / h.length : 0
      return { t, typical, lkr: toLKR(spendMinor(t), t.currency, usdRate) }
    })
    .filter(x => x.typical > 0 && x.lkr >= x.typical * 2.5)
    .sort((a, b) => b.lkr - a.lkr)
    .slice(0, 5)
    .map(x => ({ category: catName.get(x.t.categoryId) ?? 'Unknown', amountRs: rs(x.lkr), date: x.t.date, typicalRs: rs(x.typical) }))

  return {
    cycle: periodLabel(p.startDate, p.endDate),
    open,
    dayOfCycle,
    typicalCycleDays: typical,
    incomeRs: rs(cur.income),
    spendingRs: rs(cur.spending),
    prevCycleSpendingRs: prev ? rs(prev.spending) : null,
    savingsRatePct: cur.income > 0 ? Math.round(((cur.income - cur.spending) / cur.income) * 100) : null,
    projectedSpendingRs: canProject ? rs(cur.spending / elapsed) : null,
    categories: cats,
    unusualExpenses: unusual,
    recurring: recurring.slice(0, 8).map(r => ({ name: r.name, kind: r.kind, amountRs: rs(toLKR(r.amountMinor, r.currency, usdRate)) })),
    friendsOweMeRs: rs(outstandingLKR(o.receivables ?? [], txns, usdRate)),
    cyclesCompared: Math.min(periodIdx, 4)
  }
}
