import { MARKET_TYPES, type Account, type Investment, type InvestmentType, type Period, type Txn } from '../db/db'
import { computeBalances } from './balances'
import { currentValueMinor, fdMaturityMinor, profitMinor } from './investments'
import { computeTotals } from './periods'
import { toLKR } from './money'
import { todayISO } from './dates'

const rs = (minor: number) => Math.round(minor / 100)
const dayNum = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

export const TYPE_LABEL: Record<InvestmentType, string> = {
  savings: 'Savings',
  fd: 'Fixed deposit',
  stocks: 'Stocks',
  crypto: 'Crypto',
  gold: 'Gold',
  epf: 'EPF/ETF',
  other: 'Other'
}

export interface HoldingFact {
  label: string
  type: string
  /** only for market assets (needed so the model can look up news); never for FDs/savings */
  symbol?: string
  valueRs: number
  weightPct: number
  costBasisRs?: number
  pnlRs?: number
  pnlPct?: number
  fdRatePct?: number
  fdMaturity?: string
  fdDaysToMaturity?: number
  fdMaturityValueRs?: number
  /** price not refreshed recently (or never) */
  stalePrice?: boolean
}

export interface PortfolioFacts {
  totalRs: number
  holdings: HoldingFact[]
  allocation: { type: string; valueRs: number; pct: number }[]
  largestHoldingPct: number
  top3Pct: number
  /** share held in assets priced in USD (stocks, crypto, gold, USD-denominated holdings) */
  usdLinkedPct: number
  /** share in fixed deposits / savings / EPF (low-volatility, income-type) */
  stablePct: number
  fdMaturingWithin90d: { label: string; date: string; valueRs: number }[]
  /** liquid cash (non-credit accounts) vs typical monthly spending */
  cashRs: number
  avgMonthlySpendRs: number | null
  emergencyMonths: number | null
  today: string
}

const STALE_MS = 3 * 86_400_000

/** All the numbers the model narrates for the portfolio — computed locally. */
export function computePortfolioFacts(o: {
  investments: Investment[]
  accounts: Account[]
  txns: Txn[]
  periods: Period[]
  usdRate: number
}): PortfolioFacts | null {
  const { investments, accounts, txns, periods, usdRate } = o
  if (!investments.length) return null
  const today = todayISO()
  const valued = investments.map(i => ({ i, lkr: toLKR(currentValueMinor(i, usdRate), i.currency, usdRate) }))
  const total = valued.reduce((s, v) => s + v.lkr, 0)
  const counters = new Map<string, number>()

  const holdings: HoldingFact[] = valued
    .sort((a, b) => b.lkr - a.lkr)
    .map(({ i, lkr }) => {
      const market = MARKET_TYPES.includes(i.type)
      const n = (counters.get(i.type) ?? 0) + 1
      counters.set(i.type, n)
      const h: HoldingFact = {
        // names of FDs/savings stay out of the request; market assets need their name/symbol for lookups
        label: market ? i.name : `${TYPE_LABEL[i.type]} #${n}`,
        type: TYPE_LABEL[i.type],
        valueRs: rs(lkr),
        weightPct: total ? Math.round((lkr / total) * 100) : 0
      }
      if (market) {
        if (i.symbol) h.symbol = i.symbol
        h.stalePrice = !i.livePriceAt || Date.now() - i.livePriceAt > STALE_MS
        const pl = profitMinor(i, usdRate)
        if (pl != null && i.costBasisMinor) {
          h.costBasisRs = rs(toLKR(i.costBasisMinor, i.currency, usdRate))
          h.pnlRs = rs(toLKR(pl, i.currency, usdRate))
          h.pnlPct = Math.round((pl / i.costBasisMinor) * 100)
        }
      }
      if (i.type === 'fd') {
        if (i.interestRate != null) h.fdRatePct = i.interestRate
        if (i.maturityDate) {
          h.fdMaturity = i.maturityDate
          h.fdDaysToMaturity = Math.round(dayNum(i.maturityDate) - dayNum(today))
        }
        const mat = fdMaturityMinor(i)
        if (mat != null) h.fdMaturityValueRs = rs(toLKR(mat, i.currency, usdRate))
      }
      return h
    })

  const byType = new Map<string, number>()
  for (const v of valued) byType.set(TYPE_LABEL[v.i.type], (byType.get(TYPE_LABEL[v.i.type]) ?? 0) + v.lkr)
  const allocation = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, v]) => ({ type, valueRs: rs(v), pct: total ? Math.round((v / total) * 100) : 0 }))

  const usdLinked = valued.filter(v => MARKET_TYPES.includes(v.i.type) || v.i.currency === 'USD').reduce((s, v) => s + v.lkr, 0)
  const stable = valued.filter(v => ['fd', 'savings', 'epf'].includes(v.i.type)).reduce((s, v) => s + v.lkr, 0)

  // Emergency cover: liquid cash across non-credit accounts vs average spending of up to 3 completed cycles
  const balances = computeBalances(accounts, txns, usdRate)
  const cash = accounts
    .filter(a => a.type !== 'credit')
    .reduce((s, a) => s + Math.max(0, toLKR(balances.get(a.id) ?? 0, a.currency ?? 'LKR', usdRate)), 0)
  const done = periods.filter(p => p.endDate !== null).slice(-3)
  const avgSpend = done.length ? done.reduce((s, p) => s + computeTotals(txns, p, usdRate).spendingMinor, 0) / done.length : null

  return {
    totalRs: rs(total),
    holdings,
    allocation,
    largestHoldingPct: holdings[0]?.weightPct ?? 0,
    top3Pct: holdings.slice(0, 3).reduce((s, h) => s + h.weightPct, 0),
    usdLinkedPct: total ? Math.round((usdLinked / total) * 100) : 0,
    stablePct: total ? Math.round((stable / total) * 100) : 0,
    fdMaturingWithin90d: holdings
      .filter(h => h.fdDaysToMaturity != null && h.fdDaysToMaturity >= 0 && h.fdDaysToMaturity <= 90)
      .map(h => ({ label: h.label, date: h.fdMaturity!, valueRs: h.fdMaturityValueRs ?? h.valueRs })),
    cashRs: rs(cash),
    avgMonthlySpendRs: avgSpend != null ? rs(avgSpend) : null,
    emergencyMonths: avgSpend && avgSpend > 0 ? Math.round((cash / avgSpend) * 10) / 10 : null,
    today
  }
}
