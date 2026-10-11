import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS } from '../db/db'
import { analyzeMarket, type MarketReport, type Tone } from '../lib/ai'
import { computePortfolioFacts } from '../lib/portfolio'
import { fmt } from '../lib/money'
import Sheet from './Sheet'

const TONE: Record<Tone, { icon: string; bar: string }> = {
  good: { icon: '✅', bar: 'border-emerald-500' },
  watch: { icon: '👀', bar: 'border-amber-500' },
  alert: { icon: '🚨', bar: 'border-rose-500' }
}
const TYPE_COLOR: Record<string, string> = {
  Savings: '#10b981',
  'Fixed deposit': '#06b6d4',
  Stocks: '#6366f1',
  Crypto: '#f59e0b',
  Gold: '#eab308',
  'EPF/ETF': '#8b5cf6',
  Other: '#64748b'
}
const lkr = (rs: number) => fmt(rs * 100, 'LKR', { compactCents: true })

interface Cached {
  at: number
  report: MarketReport
}
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
    /* no storage — just no cache */
  }
}

/** Portfolio analysis from the user's investments + current market context (Gemini with Google Search). */
export default function MarketSheet({ onClose }: { onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const investments = useLiveQuery(() => db.investments.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const periods = useLiveQuery(() => db.periods.orderBy('startDate').toArray(), [], [])

  const [useSearch, setUseSearch] = useState(true)
  const [cached, setCached] = useState<Cached | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const apiKey = settings?.geminiApiKey
  const facts = useMemo(
    () => computePortfolioFacts({ investments, accounts, txns, periods, usdRate: settings?.usdRate ?? 300 }),
    [investments, accounts, txns, periods, settings?.usdRate]
  )
  // Market news moves daily, so a saved analysis is reused only for the same holdings on the same day
  const key = facts ? `ai-market:${facts.today}:${facts.totalRs}:${facts.holdings.length}:${useSearch ? 's' : 'n'}` : ''
  useEffect(() => {
    setCached(key ? readCache(key) : null)
  }, [key])

  async function run() {
    if (!apiKey || !facts) return
    setBusy(true)
    setError('')
    try {
      const report = await analyzeMarket({ apiKey, model: settings?.geminiModel, facts, useSearch })
      const c = { at: Date.now(), report }
      writeCache(key, c)
      setCached(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (!facts) {
    return (
      <Sheet onClose={onClose} title="✨ Market analysis">
        <p className="py-6 text-center text-sm text-slate-400">Add an investment first.</p>
      </Sheet>
    )
  }

  const report = cached?.report
  return (
    <Sheet onClose={onClose} title="✨ Market analysis">
      {/* Local snapshot — no AI needed */}
      <div className="mb-3">
        <p className="text-xs text-slate-400">Portfolio value</p>
        <p className="text-2xl font-bold tabular-nums">{lkr(facts.totalRs)}</p>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full">
          {facts.allocation.map(a => (
            <span key={a.type} style={{ width: `${a.pct}%`, backgroundColor: TYPE_COLOR[a.type] ?? '#64748b' }} title={`${a.type} ${a.pct}%`} />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          {facts.allocation.map(a => (
            <span key={a.type} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_COLOR[a.type] ?? '#64748b' }} />
              {a.type} {a.pct}%
            </span>
          ))}
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Stat label="Biggest holding" value={`${facts.largestHoldingPct}%`} tone={facts.largestHoldingPct >= 50 ? 'bad' : undefined} />
        <Stat label="USD-linked" value={`${facts.usdLinkedPct}%`} sub="stocks, crypto, gold, USD" />
        <Stat label="Stable (FD/savings/EPF)" value={`${facts.stablePct}%`} />
        {facts.emergencyMonths != null && (
          <Stat
            label="Cash cover"
            value={`${facts.emergencyMonths} mo`}
            sub="liquid cash ÷ avg monthly spend"
            tone={facts.emergencyMonths < 3 ? 'bad' : undefined}
          />
        )}
      </div>
      {facts.fdMaturingWithin90d.length > 0 && (
        <p className="mb-4 rounded-2xl bg-sky-50 p-3 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
          🏦 {facts.fdMaturingWithin90d.length} fixed deposit{facts.fdMaturingWithin90d.length > 1 ? 's' : ''} maturing within 90 days (
          {lkr(facts.fdMaturingWithin90d.reduce((s, f) => s + f.valueRs, 0))})
        </p>
      )}

      {!apiKey ? (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Add a free Gemini key in <b>Settings → AI insights</b> to get market context and a written analysis.
        </div>
      ) : (
        <>
          <label className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <span className="text-sm">
              <span className="font-medium">Include live market news</span>
              <span className="block text-xs text-slate-400">Uses Google Search through Gemini (free allowance applies)</span>
            </span>
            <input type="checkbox" checked={useSearch} onChange={e => setUseSearch(e.target.checked)} className="h-5 w-5 accent-indigo-500" />
          </label>

          <button
            onClick={run}
            disabled={busy}
            className="mb-3 w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-50"
          >
            {busy ? 'Analysing (this can take a bit)…' : report ? '↻ Re-analyse' : '✨ Analyse my investments'}
          </button>
          {error && <p className="mb-3 rounded-2xl bg-rose-50 p-3 text-sm font-medium text-rose-500 dark:bg-rose-500/10">{error}</p>}

          {report && (
            <div className="mb-4">
              {report.searchUnavailable && (
                <p className="mb-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  Live search wasn't available right now, so this is based on your holdings only.
                </p>
              )}
              <p className="mb-3 text-base font-semibold leading-snug">{report.headline}</p>

              <div className="space-y-2">
                {report.portfolio.map((i, n) => (
                  <div key={n} className={`rounded-2xl border-l-4 bg-slate-50 p-3 dark:bg-slate-800/60 ${TONE[i.tone].bar}`}>
                    <p className="text-sm font-semibold">
                      {TONE[i.tone].icon} {i.title}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{i.detail}</p>
                  </div>
                ))}
              </div>

              {report.market.length > 0 && (
                <>
                  <p className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">📰 Market context</p>
                  <div className="space-y-2">
                    {report.market.map((m, n) => (
                      <div key={n} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
                        <p className="text-sm font-semibold">{m.topic}</p>
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{m.summary}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {report.actions.length > 0 && (
                <div className="mt-3 rounded-2xl bg-indigo-50 p-3 dark:bg-indigo-500/10">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Things to consider</p>
                  <ul className="space-y-1 text-sm">
                    {report.actions.map((a, n) => (
                      <li key={n} className="flex gap-2">
                        <span className="text-indigo-500">→</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.grounding && report.grounding.sources.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Sources</p>
                  <ul className="space-y-0.5 text-xs">
                    {report.grounding.sources.slice(0, 6).map(s => (
                      <li key={s.uri} className="truncate">
                        <a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">
                          {s.title || new URL(s.uri).hostname}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.grounding?.suggestionsHtml && (
                // Google requires its Search Suggestions to be shown with grounded answers; sandboxed so it can't touch the app
                <iframe
                  title="Google Search suggestions"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={report.grounding.suggestionsHtml}
                  className="mt-2 h-14 w-full rounded-xl border-0 bg-transparent"
                />
              )}
              <p className="mt-2 text-[11px] text-slate-400">Generated {new Date(cached!.at).toLocaleString()}</p>
            </div>
          )}

          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Sends your holdings' types, values and gains/losses, plus names/symbols of stocks, crypto and gold (so news can be found), your
            cash total and average monthly spend. FD and savings names, notes and account details stay on your device. Information only — not
            financial advice; markets can move against you. On the free tier Google may use requests to improve its products.
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
