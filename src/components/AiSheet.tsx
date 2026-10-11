import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS } from '../db/db'
import { analyze, ask, type InsightReport, type Tone } from '../lib/ai'
import { computeFacts, type Facts } from '../lib/insights'
import { fmt } from '../lib/money'
import Sheet from './Sheet'

const TONE: Record<Tone, { icon: string; bar: string }> = {
  good: { icon: '✅', bar: 'border-emerald-500' },
  watch: { icon: '👀', bar: 'border-amber-500' },
  alert: { icon: '🚨', bar: 'border-rose-500' }
}

const lkr = (rs: number) => fmt(rs * 100, 'LKR', { compactCents: true })

interface Cached {
  at: number
  report: InsightReport
}

/** Cache key changes when the cycle or its data changes, so stale analyses aren't shown. */
const cacheKey = (f: Facts) => `ai-report:${f.cycle}:${f.spendingRs}:${f.incomeRs}:${f.categories.length}`
const readCache = (k: string): Cached | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null')
  } catch {
    return null
  }
}
const writeCache = (k: string, v: Cached) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage unavailable — fine, just no cache */
  }
}

/** Spending analysis: local facts always, Gemini narrative on demand (user's free AI Studio key). */
export default function AiSheet({ periodIdx, onClose }: { periodIdx: number; onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const periods = useLiveQuery(() => db.periods.orderBy('startDate').toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const recurring = useLiveQuery(() => db.recurring.toArray(), [], [])
  const receivables = useLiveQuery(() => db.receivables.toArray(), [], [])

  const [report, setReport] = useState<Cached | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)

  const apiKey = settings?.geminiApiKey
  const facts = computeFacts({ periods, periodIdx, txns, categories, recurring, receivables, usdRate: settings?.usdRate ?? 300 })
  const key = facts ? cacheKey(facts) : ''

  // Show a previous analysis for the same data instantly (saves free-tier quota)
  useEffect(() => {
    setReport(key ? readCache(key) : null)
  }, [key])

  async function run() {
    if (!apiKey || !facts) return
    setBusy(true)
    setError('')
    try {
      const r = await analyze({ apiKey, model: settings?.geminiModel, facts })
      const cached = { at: Date.now(), report: r }
      writeCache(key, cached)
      setReport(cached)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function followUp() {
    if (!apiKey || !facts || !question.trim()) return
    setAsking(true)
    setError('')
    setAnswer('')
    try {
      setAnswer(await ask({ apiKey, model: settings?.geminiModel, facts, question }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setAsking(false)
    }
  }

  if (!facts) {
    return (
      <Sheet onClose={onClose} title="✨ AI analysis">
        <p className="py-6 text-center text-sm text-slate-400">No budget cycle to analyse yet.</p>
      </Sheet>
    )
  }

  const projected = facts.projectedSpendingRs
  const overIncome = projected != null && facts.incomeRs > 0 && projected > facts.incomeRs

  return (
    <Sheet onClose={onClose} title="✨ AI analysis">
      <p className="mb-3 text-xs text-slate-400">{facts.cycle}{facts.open ? ` · day ${facts.dayOfCycle}` : ''}</p>

      {/* Local snapshot: always available, no AI needed */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Stat label="Spent" value={lkr(facts.spendingRs)} sub={facts.prevCycleSpendingRs != null ? `last cycle ${lkr(facts.prevCycleSpendingRs)}` : undefined} />
        <Stat label="Income" value={lkr(facts.incomeRs)} />
        {facts.savingsRatePct != null && (
          <Stat label="Savings rate" value={`${facts.savingsRatePct}%`} tone={facts.savingsRatePct < 0 ? 'bad' : undefined} />
        )}
        {projected != null && (
          <Stat label="On pace to spend" value={lkr(projected)} sub="by cycle end" tone={overIncome ? 'bad' : undefined} />
        )}
      </div>

      {!apiKey ? (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          <p className="mb-2 font-semibold text-slate-700 dark:text-slate-200">Turn on AI insights (free)</p>
          <ol className="mb-2 list-decimal space-y-1 pl-5">
            <li>
              Create a key at <b>aistudio.google.com/apikey</b> (no billing needed)
            </li>
            <li>
              Paste it in <b>Settings → AI insights</b>
            </li>
          </ol>
          <p className="text-xs">A Gemini Plus / AI Plus subscription doesn't include API access — the free AI Studio key does.</p>
        </div>
      ) : (
        <>
          <button
            onClick={run}
            disabled={busy}
            className="mb-3 w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-50"
          >
            {busy ? 'Analysing…' : report ? '↻ Re-analyse' : '✨ Analyse my spending'}
          </button>

          {error && <p className="mb-3 rounded-2xl bg-rose-50 p-3 text-sm font-medium text-rose-500 dark:bg-rose-500/10">{error}</p>}

          {report && (
            <div className="mb-4">
              <p className="mb-3 text-base font-semibold leading-snug">{report.report.headline}</p>
              <div className="space-y-2">
                {report.report.insights.map((i, n) => (
                  <div key={n} className={`rounded-2xl border-l-4 bg-slate-50 p-3 dark:bg-slate-800/60 ${TONE[i.tone].bar}`}>
                    <p className="text-sm font-semibold">
                      {TONE[i.tone].icon} {i.title}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{i.detail}</p>
                  </div>
                ))}
              </div>
              {report.report.actions.length > 0 && (
                <div className="mt-3 rounded-2xl bg-indigo-50 p-3 dark:bg-indigo-500/10">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Next steps</p>
                  <ul className="space-y-1 text-sm">
                    {report.report.actions.map((a, n) => (
                      <li key={n} className="flex gap-2">
                        <span className="text-indigo-500">→</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">Generated {new Date(report.at).toLocaleString()}</p>
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && followUp()}
              placeholder="Ask a follow-up…"
              className="min-w-0 flex-1 rounded-2xl bg-slate-100 px-4 py-3 text-sm outline-none dark:bg-slate-800"
            />
            <button
              onClick={followUp}
              disabled={asking || !question.trim()}
              className="rounded-2xl bg-slate-800 px-4 text-sm font-bold text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
            >
              {asking ? '…' : 'Ask'}
            </button>
          </div>
          {answer && <Answer text={answer} />}

          <p className="mt-4 text-xs leading-relaxed text-slate-400">
            Sends only aggregated totals (per category, per cycle), budgets and recurring payment names/amounts — no notes,
            merchants, account details or receipts. On the free tier Google may use requests to improve its products. Not financial advice.
          </p>
        </>
      )}
    </Sheet>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'bad' ? 'text-rose-500' : ''}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

/** Minimal rendering of free-text answers: bullets and **bold**. */
function Answer({ text }: { text: string }) {
  return (
    <div className="mt-3 space-y-1.5 rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed dark:bg-slate-800/60">
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line)
        const body = line.replace(/^\s*[-*•]\s+/, '')
        if (!body.trim()) return null
        const parts = body.split(/\*\*(.+?)\*\*/g)
        return (
          <p key={i} className={bullet ? 'flex gap-2' : undefined}>
            {bullet && <span className="text-indigo-500">•</span>}
            <span>{parts.map((p, j) => (j % 2 ? <b key={j}>{p}</b> : p))}</span>
          </p>
        )
      })}
    </div>
  )
}
