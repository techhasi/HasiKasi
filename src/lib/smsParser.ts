import type { CategoryKind, Currency } from '../db/db'
import { todayISO } from './dates'

export interface ParsedSms {
  raw: string
  type: CategoryKind
  /** null = no amount found (unparseable message) */
  amountMinor: number | null
  currency: Currency
  date: string
  merchant: string
  accountHint: string | null
}

const EXPENSE_WORDS = ['debit', 'purchase', 'spent', 'withdraw', 'payment', 'paid', 'charged', 'pos ', 'bill', 'transfer to']
const INCOME_WORDS = ['credit', 'received', 'deposit', 'salary', 'refund', 'remittance', 'transfer from', 'interest paid']

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function toISO(y: number, mo: number, d: number): string | null {
  if (y < 100) y += 2000
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseDate(text: string): string | null {
  // dd/mm/yy, dd.mm.yyyy, dd-mm-yy
  let m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/)
  if (m) {
    const iso = toISO(+m[3], +m[2], +m[1])
    if (iso) return iso
  }
  // dd-Jul-26, 21 Jul 2026, 21Jul26
  m = text.match(/\b(\d{1,2})[\s-]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]*(\d{2,4})\b/i)
  if (m) {
    const iso = toISO(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])
    if (iso) return iso
  }
  return null
}

/** Find the transaction amount, skipping balance figures ("Avl Bal LKR ..."). */
function parseAmountAndCurrency(text: string): { amountMinor: number; currency: Currency } | null {
  const re = /(LKR|SLR|Rs\.?|USD|\$)\s*([\d,]+(?:\.\d{1,2})?)/gi
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 18), m.index).toLowerCase()
    if (/\b(bal|balance|avl|available|limit)\b/.test(before)) continue
    const n = parseFloat(m[2].replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) continue
    const cur = /usd|\$/i.test(m[1]) ? 'USD' : 'LKR'
    return { amountMinor: Math.round(n * 100), currency: cur }
  }
  return null
}

function parseType(text: string): CategoryKind {
  // "credit card" is a payment instrument, not an income signal
  const lower = text.toLowerCase().replace(/credit\s*card/g, 'ccard')
  let best: { type: CategoryKind; idx: number } | null = null
  for (const w of EXPENSE_WORDS) {
    const i = lower.indexOf(w)
    if (i !== -1 && (!best || i < best.idx)) best = { type: 'expense', idx: i }
  }
  for (const w of INCOME_WORDS) {
    const i = lower.indexOf(w)
    if (i !== -1 && (!best || i < best.idx)) best = { type: 'income', idx: i }
  }
  return best?.type ?? 'expense'
}

/** Candidates that are really account/card references, not merchant names. */
function looksLikeAccountRef(s: string): boolean {
  return /^(?:a\/?c|acc(?:ount)?|card|your)\b/i.test(s) || /[*#•x]{2,}/i.test(s) || /^\d+$/.test(s.replace(/\s/g, ''))
}

function parseMerchant(text: string): string {
  // "at KEELLS SUPER on ...", "to JOHN via ...", "from ACME for ..." — skip account refs.
  // Capture stops before trailing balance snippets ("WATCH HOUSE Avl Bal LKR ...").
  for (const m of text.matchAll(/\b(?:at|to|from)\s+([^\n.,;]{2,40}?)(?=\s+(?:on|for|via|ref|with|using|lkr|slr|rs|usd|avl|available|bal|balance|total|limit|outstanding)\b|[.,;\n]|$)/gi)) {
    const candidate = m[1].trim()
    if (!looksLikeAccountRef(candidate)) return candidate
  }
  // "Reason: ATM Withdrawal", "Desc: ...", "Remarks: ..."
  const m = text.match(/\b(?:reason|desc(?:ription)?|remarks?|narration)\s*:?\s*([^\n.,;]{2,40})/i)
  if (m) return m[1].trim()
  return ''
}

function parseAccountHint(text: string): string | null {
  const m =
    text.match(/\b(?:card|a\/?c|acc(?:ount)?)\s*(?:no\.?|number)?\s*[x*#•]*\s*(\d{3,4})\b/i) ??
    text.match(/\bending(?:\s+in)?\s*[x*#•]*\s*(\d{3,4})\b/i) ??
    text.match(/[x*#•]{3,}\s*(\d{3,4})\b/)
  return m ? m[1] : null
}

function parseOne(raw: string): ParsedSms {
  const amt = parseAmountAndCurrency(raw)
  return {
    raw,
    type: parseType(raw),
    amountMinor: amt?.amountMinor ?? null,
    currency: amt?.currency ?? 'LKR',
    date: parseDate(raw) ?? todayISO(),
    merchant: parseMerchant(raw),
    accountHint: parseAccountHint(raw)
  }
}

/** Parse pasted text: each blank-line-separated block is treated as one SMS. */
export function parseSms(text: string): ParsedSms[] {
  return text
    .split(/\n\s*\n+/)
    .map(b => b.trim())
    .filter(Boolean)
    .map(parseOne)
}
