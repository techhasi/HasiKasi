import { db, uid, type Recurring } from '../db/db'
import { todayISO } from './dates'

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Advance a due date by the interval, keeping dayOfMonth clamped to month length. */
export function advanceDue(current: string, dayOfMonth: number, intervalMonths: number): string {
  const [y, m] = current.split('-').map(Number)
  const monthIndex = m - 1 + intervalMonths
  const year = y + Math.floor(monthIndex / 12)
  const month = monthIndex % 12
  const lastDay = new Date(year, month + 1, 0).getDate()
  return iso(year, month + 1, Math.min(dayOfMonth, lastDay))
}

/** First due date on/after today for a given day of month. */
export function firstDue(dayOfMonth: number): string {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const candidate = iso(now.getFullYear(), now.getMonth() + 1, Math.min(dayOfMonth, lastDay))
  return candidate >= todayISO() ? candidate : advanceDue(candidate, dayOfMonth, 1)
}

/** Log the due occurrence as a transaction and advance the schedule. */
export async function logRecurring(r: Recurring): Promise<void> {
  await db.transaction('rw', [db.txns, db.recurring], async () => {
    await db.txns.add({
      id: uid(),
      type: 'expense',
      amountMinor: r.amountMinor,
      currency: r.currency,
      categoryId: r.categoryId,
      accountId: r.accountId,
      date: r.nextDue <= todayISO() ? r.nextDue : todayISO(),
      note: r.note ? `${r.name} · ${r.note}` : r.name,
      createdAt: Date.now()
    })
    const patch: Partial<Recurring> = { nextDue: advanceDue(r.nextDue, r.dayOfMonth, r.intervalMonths) }
    if (r.kind === 'loan') patch.paidMinor = (r.paidMinor ?? 0) + r.amountMinor
    await db.recurring.update(r.id, patch)
  })
}

/** Skip this occurrence without logging a transaction. */
export async function skipRecurring(r: Recurring): Promise<void> {
  await db.recurring.update(r.id, { nextDue: advanceDue(r.nextDue, r.dayOfMonth, r.intervalMonths) })
}
