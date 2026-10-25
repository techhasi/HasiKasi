import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Account } from '../db/db'
import { fmt } from '../lib/money'
import { currentMonth } from '../lib/dates'
import { computeBalances } from '../lib/balances'
import { loanRemaining, payCardAdvanceLoans } from '../lib/recurring'
import Sheet from './Sheet'
import AddSheet from './AddSheet'

type Mode = 'with' | 'without'

/**
 * Pay a credit-card bill. If the card has instalment/recurring payments, first ask whether to
 * include them in this payment ("with" — each instalment is paid, so its loan balance drops and
 * its schedule rolls on) or to pay only the card's own spending ("without").
 */
export default function CardPayFlow({ account, onClose }: { account: Account; onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const recurring = useLiveQuery(() => db.recurring.toArray(), [], [])
  const [mode, setMode] = useState<Mode | null>(null)

  const cur = account.currency ?? 'LKR'
  const calc = useMemo(() => {
    const balance = computeBalances(accounts, txns, settings?.usdRate ?? 300).get(account.id) ?? 0
    const loans = recurring.filter(r => r.kind === 'loan' && r.accountId === account.id && loanRemaining(r) > 0)
    const loanRem = loans.reduce((s, r) => s + loanRemaining(r), 0)
    const items = loans.map(r => ({ r, inst: Math.min(r.amountMinor, loanRemaining(r)) }))
    // Loan principal is already inside the card balance; only this month's instalment is "due"
    const revolving = Math.max(0, -balance - loanRem)
    const instalments = items.reduce((s, i) => s + i.inst, 0)
    return { items, revolving, instalments }
  }, [accounts, txns, recurring, settings?.usdRate, account.id])

  // Nothing recurring on this card → straight to the payment, as before
  const effectiveMode: Mode | null = calc.items.length === 0 ? 'without' : mode
  if (!effectiveMode) {
    return (
      <Sheet onClose={onClose} title={`💳 Pay ${account.name}`}>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          This card has recurring instalment payments. How do you want to log this payment?
        </p>

        <button
          onClick={() => setMode('with')}
          className="mb-3 w-full rounded-2xl border-2 border-indigo-500 bg-indigo-50 p-4 text-left dark:bg-indigo-500/10"
        >
          <p className="text-sm font-bold">Include recurring payments</p>
          <p className="text-2xl font-bold tabular-nums">{fmt(calc.revolving + calc.instalments, cur, { compactCents: true })}</p>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            {fmt(calc.revolving, cur, { compactCents: true })} card spending + {fmt(calc.instalments, cur, { compactCents: true })} instalments
          </p>
          <div className="space-y-0.5 rounded-xl bg-white/70 p-2 text-xs dark:bg-slate-900/40">
            {calc.items.map(({ r, inst }) => (
              <p key={r.id} className="flex justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  −{fmt(inst, r.currency, { compactCents: true })} → {fmt(loanRemaining(r) - inst, r.currency, { compactCents: true })} left
                </span>
              </p>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Each instalment is marked paid: the loan balance goes down and its next due date moves on.</p>
        </button>

        <button
          onClick={() => setMode('without')}
          disabled={calc.revolving <= 0}
          className="w-full rounded-2xl border-2 border-transparent bg-slate-50 p-4 text-left disabled:opacity-40 dark:bg-slate-800/60"
        >
          <p className="text-sm font-bold">Just log the amount</p>
          <p className="text-2xl font-bold tabular-nums">{fmt(calc.revolving, cur, { compactCents: true })}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {calc.revolving > 0
              ? 'Card spending only. Instalments are left unpaid and still show as due.'
              : 'Nothing besides the instalments is owed on this card.'}
          </p>
        </button>
      </Sheet>
    )
  }

  const withRecurring = effectiveMode === 'with' && calc.items.length > 0
  const target = withRecurring ? calc.revolving + calc.instalments : calc.revolving

  return (
    <AddSheet
      initial={{
        type: 'transfer',
        amount: (target / 100).toFixed(2),
        currency: cur,
        toAccountId: account.id,
        note: `${account.name} bill`
      }}
      onSaved={async saved => {
        // Only a transfer INTO this card counts as a bill payment.
        if (saved.type !== 'transfer' || saved.toAccountId !== account.id) return
        const paid = saved.toAmountMinor ?? saved.amountMinor
        // Settle only when the chosen amount is fully covered; partial payments just lower the
        // balance so you can pay again whenever more money comes in.
        if (paid < target) return
        if (withRecurring) {
          await db.accounts.update(account.id, { lastPaidMonth: currentMonth(), statementMinor: undefined })
          await payCardAdvanceLoans(account.id)
        } else if (calc.items.length === 0) {
          await db.accounts.update(account.id, { lastPaidMonth: currentMonth(), statementMinor: undefined })
        } else {
          // Instalments were deliberately left out: keep the card "due" for them
          await db.accounts.update(account.id, { statementMinor: undefined })
        }
      }}
      onClose={onClose}
    />
  )
}
