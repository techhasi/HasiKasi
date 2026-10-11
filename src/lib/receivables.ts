import { db, uid, type Currency, type Receivable, type Txn } from '../db/db'
import { todayISO } from './dates'
import { toLKR } from './money'

export interface ReceivableView {
  r: Receivable
  txn: Txn | undefined
  paidMinor: number
  remainingMinor: number
}

/** Repayments received so far = balance-only entries linked to this receivable. */
export function paidOf(r: Receivable, txns: Txn[]): number {
  return txns.filter(t => t.receivableId === r.id).reduce((s, t) => s + t.amountMinor, 0)
}

export function viewOf(r: Receivable, txns: Txn[]): ReceivableView {
  const paid = paidOf(r, txns)
  return {
    r,
    txn: txns.find(t => t.id === r.txnId),
    paidMinor: paid,
    remainingMinor: Math.max(0, r.amountMinor - paid - (r.writtenOffMinor ?? 0))
  }
}

/** Total still owed to me, in LKR minor units. */
export function outstandingLKR(receivables: Receivable[], txns: Txn[], usdRate: number): number {
  return receivables.reduce((s, r) => s + toLKR(viewOf(r, txns).remainingMinor, r.currency, usdRate), 0)
}

/** Equal split: what the other people owe when `people` (including me) share `amountMinor`. */
export function equalSplitOwed(amountMinor: number, people: number): number {
  return Math.round((amountMinor * (people - 1)) / Math.max(2, people))
}

/**
 * A friend pays me back. Adds money to the account without counting as income
 * (so earnings and savings rate stay honest).
 */
export async function recordRepayment(r: Receivable, amountMinor: number, accountId: string, date = todayISO()): Promise<void> {
  await db.txns.add({
    id: uid(),
    type: 'income',
    amountMinor,
    currency: r.currency as Currency,
    categoryId: '',
    accountId,
    date,
    note: `Repaid by ${r.person || 'friends'}`,
    adjustment: true,
    receivableId: r.id,
    createdAt: Date.now()
  })
}

/** Give up on the remaining amount: it becomes part of my own share of that expense. */
export async function writeOff(r: Receivable, remainingMinor: number): Promise<void> {
  await db.transaction('rw', [db.receivables, db.txns], async () => {
    const t = await db.txns.get(r.txnId)
    if (t) await db.txns.update(t.id, { ownShareMinor: (t.ownShareMinor ?? t.amountMinor) + remainingMinor })
    await db.receivables.update(r.id, { writtenOffMinor: (r.writtenOffMinor ?? 0) + remainingMinor })
  })
}

/** Remove the receivable that belongs to a deleted expense (repayments stay as balance entries). */
export async function deleteForTxn(txnId: string): Promise<void> {
  await db.receivables.where('txnId').equals(txnId).delete()
}
