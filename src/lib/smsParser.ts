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
  /** bank-stated available balance, when present ("Avl Bal LKR 50,000.00") */
  balanceMinor: number | null
  balanceCurrency: Currency
}

const EXPENSE_WORDS = ['debit', 'purchase', 'spent', 'withdraw', 'payment', 'paid', 'charged', 'pos ', 'bill', 'transfer to']
const INCOME_WORDS = ['credit', 'received', 'deposit', 'salary', 'refund', 'remittance', 'transfer from', 'interest paid']

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function toISO(y: number, mo: number, d: number): string | null {
  if (y < 100) y += 2000
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function numericDate(dRaw: number, moRaw: number, y: number): string | null {
  // Default dd/mm; swap for US-style mm/dd (FriMi/NTB) when dd-position can't be a day's month
  let d = dRaw
  let mo = moRaw
  if (mo > 12 && d <= 12) [d, mo] = [mo, d]
  return toISO(y, mo, d)
}

function parseDate(text: string): string | null {
  // Prefer a date carrying a timestamp — that's the actual transaction moment,
  // not e.g. an interest period ("Int.Pd:20-06-2026 to 19-07-2026")
  const patterns = [
    /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b(?=\s+\d{1,2}:\d{2})/g,
    /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const iso = numericDate(+m[1], +m[2], +m[3])
      if (iso) return iso
    }
  }
  // dd-Jul-26, 21 Jul 2026, 21Jul26
  const m = text.match(/\b(\d{1,2})[\s-]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]*(\d{2,4})\b/i)
  if (m) {
    const iso = toISO(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])
    if (iso) return iso
  }
  return null
}

// Lookbehind stops currency tokens matching inside reference codes ("QU5ZHY9RS2")
const AMOUNT_RE = /(?<![A-Za-z0-9])(LKR|SLR|Rs\.?|USD|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi

function isBalanceContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 20), index).toLowerCase()
  return /\b(bal|balance|avl|avail|available|limit|current)\b/.test(before)
}

/** Find the transaction amount, skipping balance figures ("Avl Bal LKR ..."). */
function parseAmountAndCurrency(text: string): { amountMinor: number; currency: Currency } | null {
  for (const m of text.matchAll(AMOUNT_RE)) {
    if (isBalanceContext(text, m.index)) continue
    const n = parseFloat(m[2].replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) continue
    const cur = /usd|\$/i.test(m[1]) ? 'USD' : 'LKR'
    return { amountMinor: Math.round(n * 100), currency: cur }
  }
  return null
}

/**
 * Find the bank-stated balance. Keyword-anchored so it also catches figures
 * without a currency prefix ("Card AVL BAL 101,794.80").
 */
function parseBalance(text: string): { balanceMinor: number; currency: Currency } | null {
  const m = text.match(
    /\b(?:avl|avail(?:able)?|current|bal(?:ance)?)[\s.]*(?:bal(?:ance)?)?[\s.]*(?:available)?\s*:?[\s-]*(LKR|SLR|Rs\.?|USD|\$)?\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})/i
  )
  if (!m || m.index === undefined) return null
  // Masked balances ("Balance available Rs .00") — don't sync the account to a template artifact
  if (m[2].startsWith('.')) return null
  // A credit limit is not a balance
  const before = text.slice(Math.max(0, m.index - 12), m.index).toLowerCase()
  if (/\blimit\b/.test(before)) return null
  const n = parseFloat(m[2].replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return { balanceMinor: Math.round(n * 100), currency: m[1] && /usd|\$/i.test(m[1]) ? 'USD' : 'LKR' }
}

function parseType(text: string): CategoryKind {
  // "credit card" is a payment instrument, not an income signal
  const lower = text.toLowerCase().replace(/credit\s*card/g, 'ccard')
  // Explicit DR/CR markers ("for LKR 2500.00 CR.") are the strongest signal
  const hasDr = /\bdr\b/.test(lower)
  const hasCr = /\bcr\b/.test(lower)
  if (hasDr && !hasCr) return 'expense'
  if (hasCr && !hasDr) return 'income'
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

/** Candidates that are really account/card refs, dates, or phone lines — not merchants. */
function looksLikeAccountRef(s: string): boolean {
  return (
    /^(?:a\/?c|acc(?:ount)?|card|your)\b/i.test(s) ||
    /[*#•x]{2,}/i.test(s) ||
    /^[\d\s./:-]+$/.test(s) || // bare numbers or dates ("19-07-2026")
    /\d{6,}/.test(s) || // phone numbers / reference codes
    /\b(?:call|inq(?:uiry)?|otp|sms|hotline)\b/i.test(s)
  )
}

/** Strip POS boilerplate and collapse the multi-space padding banks love. */
function cleanMerchant(s: string): string {
  return s
    .replace(/^\s*pos\s*(?:transaction)?\s*[-:]\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[-\s]+$/, '')
    .trim()
}

const MERCHANT_STOP =
  'on|for|via|ref|with|using|was|done|has|is|lkr|slr|rs|usd|avl|avail|available|bal|balance|total|limit|outstanding|current|authorised|authorized|successful'
const MERCHANT_RE = new RegExp(String.raw`\b(?:at|to|from)\s+([^\n.,;]{2,60}?)(?=\s+(?:${MERCHANT_STOP})\b|[.,;\n]|$)`, 'gi')

function parseMerchant(text: string): string {
  // "at KEELLS SUPER on ...", "to JOHN via ...", "from ACME for ..." — skip account refs.
  for (const m of text.matchAll(MERCHANT_RE)) {
    const candidate = cleanMerchant(m[1])
    if (candidate && !looksLikeAccountRef(candidate)) return candidate
  }
  // FriMi style: "Fuel Surcharge was performed ...", "POS Transaction - FACEBK ... was performed ..."
  const performed = text.match(/^(?:dear[^,\n]*,\s*)?(.{3,60}?)\s+was performed/i)
  if (performed) {
    const candidate = cleanMerchant(performed[1])
    if (candidate && !looksLikeAccountRef(candidate)) return candidate
  }
  // "Reason: ATM Withdrawal", "Desc: ...", "Remarks: ..."
  const m = text.match(/\b(?:reason|desc(?:ription)?|remarks?|narration)\s*:?\s*([^\n.,;]{2,40})/i)
  if (m) return cleanMerchant(m[1])
  return ''
}

function parseAccountHint(text: string): string | null {
  const m =
    text.match(/\b(?:card|a\/?c|acc(?:ount)?)\s*(?:no\.?|number)?\s*[x*#•]*\s*(\d{3,4})\b/i) ??
    text.match(/\bending(?:\s+in)?\s*[x*#•]*\s*(\d{3,4})\b/i) ??
    text.match(/[x*#•]{2,}\s*(\d{3,4})\b/i)
  return m ? m[1] : null
}

function parseOne(raw: string): ParsedSms {
  const amt = parseAmountAndCurrency(raw)
  const bal = parseBalance(raw)
  return {
    raw,
    type: parseType(raw),
    amountMinor: amt?.amountMinor ?? null,
    currency: amt?.currency ?? 'LKR',
    date: parseDate(raw) ?? todayISO(),
    merchant: parseMerchant(raw),
    accountHint: parseAccountHint(raw),
    balanceMinor: bal?.balanceMinor ?? null,
    balanceCurrency: bal?.currency ?? 'LKR'
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
