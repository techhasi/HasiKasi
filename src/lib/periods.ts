import { db, uid, getSettings, type Period, type Txn } from '../db/db'
import { addDaysISO } from './dates'
import { toLKR } from './money'

export async function getActivePeriod(): Promise<Period | undefined> {
  const all = await db.periods.orderBy('startDate').toArray()
  return all.find(p => p.endDate === null) ?? all[all.length - 1]
}

/** Txns belonging to a period (inclusive date range). */
export function txnsInPeriod(txns: Txn[], period: Period): Txn[] {
  return txns.filter(
    t => t.date >= period.startDate && (period.endDate === null || t.date <= period.endDate)
  )
}

export interface PeriodTotals {
  spendingMinor: number
  earningMinor: number
  carryInMinor: number
  /** carryIn + earning - spending */
  balanceMinor: number
}

export function computeTotals(txns: Txn[], period: Period, usdRate: number): PeriodTotals {
  let spending = 0
  let earning = 0
  for (const t of txnsInPeriod(txns, period)) {
    if (t.type === 'transfer') continue // moves money between accounts, not in/out
    if (t.adjustment) continue // balance corrections don't count as spending/earning
    const lkr = toLKR(t.amountMinor, t.currency, usdRate)
    if (t.type === 'expense') spending += lkr
    else earning += lkr
  }
  return {
    spendingMinor: spending,
    earningMinor: earning,
    carryInMinor: period.carryInMinor,
    balanceMinor: period.carryInMinor + earning - spending
  }
}

/**
 * Close the active period the day before `salaryDate` and open a new one.
 * Called when an income txn is saved with "starts new period" on.
 * If carry-over is enabled in settings, the closing balance rolls in.
 */
export async function startNewPeriod(salaryDate: string): Promise<void> {
  await db.transaction('rw', [db.periods, db.txns, db.settings], async () => {
    const active = await getActivePeriod()
    const settings = await getSettings()

    if (active && active.endDate === null) {
      // Guard: salary dated on/before the period start can't close it sensibly.
      if (salaryDate <= active.startDate) return

      const txns = await db.txns.toArray()
      const totals = computeTotals(txns, active, settings.usdRate)
      await db.periods.update(active.id, { endDate: addDaysISO(salaryDate, -1) })
      await db.periods.add({
        id: uid(),
        startDate: salaryDate,
        endDate: null,
        carryInMinor: settings.carryOver ? totals.balanceMinor : 0
      })
    } else {
      await db.periods.add({ id: uid(), startDate: salaryDate, endDate: null, carryInMinor: 0 })
    }
  })
}
