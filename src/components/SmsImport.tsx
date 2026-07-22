import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type PendingTxn } from '../db/db'
import { parseSms } from '../lib/smsParser'
import { fmt } from '../lib/money'
import { friendlyDate } from '../lib/dates'
import Sheet from './Sheet'
import AddSheet from './AddSheet'

export default function SmsImport({ onClose }: { onClose: () => void }) {
  const pending = useLiveQuery(() => db.pending.orderBy('createdAt').reverse().toArray(), [], [])
  const [text, setText] = useState('')
  const [info, setInfo] = useState('')
  const [adding, setAdding] = useState<PendingTxn | null>(null)

  async function parse() {
    const results = parseSms(text)
    const ok = results.filter(r => r.amountMinor !== null)
    const skipped = results.length - ok.length
    if (ok.length) {
      await db.pending.bulkAdd(
        ok.map(r => ({
          id: uid(),
          raw: r.raw,
          type: r.type,
          amountMinor: r.amountMinor!,
          currency: r.currency,
          date: r.date,
          merchant: r.merchant,
          accountHint: r.accountHint,
          createdAt: Date.now()
        }))
      )
    }
    setInfo(
      ok.length === 0
        ? '❌ No amounts found — is this a bank message?'
        : `✅ Found ${ok.length} transaction${ok.length > 1 ? 's' : ''}${skipped ? ` (${skipped} skipped, no amount)` : ''}`
    )
    if (ok.length) setText('')
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
      <button
        onClick={parse}
        disabled={!text.trim()}
        className="mb-2 w-full rounded-2xl bg-indigo-500 py-3 font-bold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-40"
      >
        Scan for transactions
      </button>
      {info && <p className="mb-3 text-center text-sm font-medium">{info}</p>}

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
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                      •••{p.accountHint}
                    </span>
                  )}
                </div>

                <p className={`text-xl font-bold tabular-nums ${p.type === 'expense' ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {p.type === 'expense' ? '−' : '+'}
                  {fmt(p.amountMinor, p.currency, { compactCents: true })}
                </p>
                {p.merchant && <p className="truncate text-sm font-medium">{p.merchant}</p>}

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
            note: adding.merchant
          }}
          onSaved={() => db.pending.delete(adding.id)}
          onClose={() => setAdding(null)}
        />
      )}
    </Sheet>
  )
}
