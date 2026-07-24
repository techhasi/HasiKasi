import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, getSettings, type PendingTxn, type Txn } from '../db/db'
import { parseSms } from '../lib/smsParser'
import { fmt } from '../lib/money'
import { friendlyDate } from '../lib/dates'
import { computeBalances, addAdjustment } from '../lib/balances'
import Sheet from './Sheet'
import AddSheet from './AddSheet'

export default function SmsImport({ onClose }: { onClose: () => void }) {
  const pending = useLiveQuery(() => db.pending.orderBy('createdAt').reverse().toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const [text, setText] = useState('')
  const [info, setInfo] = useState('')
  const [adding, setAdding] = useState<PendingTxn | null>(null)

  /** Match an SMS account hint (last digits) to a configured account. */
  function matchAccount(hint: string | null): string | undefined {
    if (!hint) return undefined
    return accounts.find(a => a.numberHint && (a.numberHint === hint || a.numberHint.endsWith(hint) || hint.endsWith(a.numberHint)))?.id
  }

  async function parse(input?: string) {
    const source = input ?? text
    const results = parseSms(source)
    const ok = results.filter(r => r.amountMinor !== null)
    const skipped = results.length - ok.length
    // Don't queue the exact same message twice — vs the inbox or within this paste
    const seen = new Set((await db.pending.toArray()).map(p => p.raw))
    const fresh = ok.filter(r => {
      if (seen.has(r.raw)) return false
      seen.add(r.raw)
      return true
    })
    const dups = ok.length - fresh.length
    if (fresh.length) {
      await db.pending.bulkAdd(
        fresh.map(r => ({
          id: uid(),
          raw: r.raw,
          type: r.type,
          amountMinor: r.amountMinor!,
          currency: r.currency,
          date: r.date,
          merchant: r.merchant,
          accountHint: r.accountHint,
          balanceMinor: r.balanceMinor ?? undefined,
          balanceCurrency: r.balanceMinor !== null ? r.balanceCurrency : undefined,
          createdAt: Date.now()
        }))
      )
    }
    const parts: string[] = []
    if (fresh.length) parts.push(`✅ ${fresh.length} found`)
    if (dups) parts.push(`${dups} already in inbox`)
    if (skipped) parts.push(`${skipped} skipped (no amount)`)
    setInfo(parts.length ? parts.join(' · ') : '❌ No amounts found — is this a bank message?')
    if (fresh.length) setText('')
  }

  /**
   * After an SMS txn is approved: if the message stated the account balance,
   * log an adjustment so the app's balance matches the bank exactly.
   */
  async function reconcile(p: PendingTxn, saved: Txn) {
    if (p.balanceMinor == null || saved.type === 'transfer') return
    const s = await getSettings()
    const [accs, txns] = await Promise.all([db.accounts.toArray(), db.txns.toArray()])
    const account = accs.find(a => a.id === saved.accountId)
    const accCurrency = account?.currency ?? 'LKR'
    // Only sync when the SMS balance is in the account's own currency
    if ((p.balanceCurrency ?? 'LKR') !== accCurrency) return
    // Credit cards state AVAILABLE CREDIT (limit − owed), not the balance.
    // Convert to the owed balance via the limit; without a limit it's ambiguous — don't sync.
    let target = p.balanceMinor
    if (account?.type === 'credit') {
      if (account.creditLimitMinor == null) {
        setInfo('ℹ️ Set this card\'s credit limit to enable balance sync from SMS')
        return
      }
      target = p.balanceMinor - account.creditLimitMinor
    }
    const computed = computeBalances(accs, txns, s.usdRate).get(saved.accountId) ?? 0
    const diff = target - computed
    const accName = account?.name ?? 'Account'
    if (diff === 0) {
      setInfo(`✅ ${accName} matches the bank balance`)
      return
    }
    await addAdjustment(saved.accountId, diff, 'Synced to bank SMS balance', saved.date, accCurrency)
    setInfo(
      `⚖️ ${accName} adjusted by ${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff), accCurrency, { compactCents: true })} to match the bank`
    )
  }

  async function pasteAndScan() {
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip.trim()) return setInfo('Clipboard is empty')
      setText(clip)
      await parse(clip)
    } catch {
      setInfo('Clipboard not available — paste manually into the box')
    }
  }

  return (
    <Sheet onClose={onClose} title="📥 SMS Import">
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Copy bank or card messages from the Messages app and paste them below — separate multiple messages
        with a blank line. I'll extract the amount, type and date; you approve each one.
      </p>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        placeholder={'Paste bank SMS here…\n\ne.g. Purchase at KEELLS for LKR 4,500.00 on 21/07/26 with card ending 1234'}
        className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />
      <div className="mb-2 flex gap-2">
        <button
          onClick={pasteAndScan}
          className="flex-1 rounded-2xl bg-slate-200 py-3 text-sm font-bold dark:bg-slate-700"
        >
          📋 Paste & scan
        </button>
        <button
          onClick={() => parse()}
          disabled={!text.trim()}
          className="flex-1 rounded-2xl bg-indigo-500 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-40"
        >
          Scan box
        </button>
      </div>
      {info && <p className="mb-3 text-center text-sm font-medium">{info}</p>}

      <details className="mb-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
        <summary className="cursor-pointer text-xs font-semibold text-slate-500 dark:text-slate-400">
          ⚡ Make it automatic with a Shortcut
        </summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <li><b>Shortcuts</b> app → <b>Automation</b> → <b>+</b> → <b>Message</b></li>
          <li>Set <b>Sender</b> to your bank's SMS name → Run Immediately → Next</li>
          <li>Add action <b>Copy to Clipboard</b> with the variable <b>Shortcut Input</b></li>
          <li>Optionally add <b>Show Notification</b>: “Bank SMS copied — open HasiKasi”</li>
          <li>Next time you open this screen, just tap <b>Paste &amp; scan</b></li>
        </ol>
        <p className="mt-2 text-xs text-slate-400">
          Tip: set the last 4 digits on each account (Accounts → tap an account) and imports will pick the right
          account automatically.
        </p>
      </details>

      {pending.length > 0 && (
        <>
          <div className="mb-2 mt-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Waiting for approval ({pending.length})
            </h3>
            <button onClick={() => db.pending.clear()} className="text-xs font-semibold text-rose-500">
              Dismiss all
            </button>
          </div>

          <div className="space-y-3">
            {pending.map(p => (
              <div key={p.id} className="rounded-2xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      p.type === 'expense'
                        ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
                        : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                    }`}
                  >
                    {p.type}
                  </span>
                  <span className="flex-1 truncate text-xs text-slate-400">{friendlyDate(p.date)}</span>
                  {p.accountHint && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        matchAccount(p.accountHint)
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      •••{p.accountHint}
                      {matchAccount(p.accountHint) && ` = ${accounts.find(a => a.id === matchAccount(p.accountHint))?.name}`}
                    </span>
                  )}
                </div>

                <p className={`text-xl font-bold tabular-nums ${p.type === 'expense' ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {p.type === 'expense' ? '−' : '+'}
                  {fmt(p.amountMinor, p.currency, { compactCents: true })}
                </p>
                {p.merchant && <p className="truncate text-sm font-medium">{p.merchant}</p>}
                {p.balanceMinor != null && (
                  <p className="text-xs text-slate-400">
                    ⚖️ bank balance: {fmt(p.balanceMinor, p.balanceCurrency ?? 'LKR', { compactCents: true })} — will sync on approve
                  </p>
                )}

                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-slate-400">Original message</summary>
                  <p className="mt-1 whitespace-pre-wrap rounded-xl bg-white p-2 text-xs text-slate-500 dark:bg-slate-900">{p.raw}</p>
                </details>

                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => db.pending.delete(p.id)}
                    className="flex-1 rounded-xl bg-slate-200 py-2 text-sm font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => setAdding(p)}
                    className="flex-1 rounded-xl bg-indigo-500 py-2 text-sm font-semibold text-white"
                  >
                    Add ✓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {adding && (
        <AddSheet
          initial={{
            type: adding.type,
            amount: (adding.amountMinor / 100).toFixed(2),
            currency: adding.currency,
            date: adding.date,
            note: adding.merchant,
            accountId: matchAccount(adding.accountHint)
          }}
          onSaved={async saved => {
            await db.pending.delete(adding.id)
            await reconcile(adding, saved)
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </Sheet>
  )
}
