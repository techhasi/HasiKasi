import { db, uid, type Account, type Txn } from '../db/db'
import { toLKR } from './money'
import { todayISO } from './dates'

/** Log a balance correction: fixes the account balance without touching budget totals. */
export async function addAdjustment(accountId: string, diffMinor: number, note: string, date = todayISO()): Promise<void> {
  await db.txns.add({
    id: uid(),
    type: diffMinor > 0 ? 'income' : 'expense',
    amountMinor: Math.abs(diffMinor),
    currency: 'LKR',
    categoryId: '',
    accountId,
    date,
    note,
    adjustment: true,
    createdAt: Date.now()
  })
}

/** Per-account balances in LKR minor units (opening + income − expenses ± transfers). */
export function computeBalances(accounts: Account[], txns: Txn[], usdRate: number): Map<string, number> {
  const map = new Map<string, number>()
  for (const a of accounts) map.set(a.id, a.openingMinor)
  for (const t of txns) {
    const lkr = toLKR(t.amountMinor, t.currency, usdRate)
    if (t.type === 'transfer') {
      map.set(t.accountId, (map.get(t.accountId) ?? 0) - lkr)
      if (t.toAccountId) map.set(t.toAccountId, (map.get(t.toAccountId) ?? 0) + lkr)
    } else {
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + (t.type === 'expense' ? -lkr : lkr))
    }
  }
  return map
}
