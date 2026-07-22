import type { Currency } from '../db/db'

export const CURRENCY_SYMBOL: Record<Currency, string> = { LKR: 'Rs', USD: '$' }

/** Format minor units (cents) as a display string, e.g. 125000 LKR -> "Rs 1,250.00" */
export function fmt(minor: number, currency: Currency = 'LKR', opts?: { compactCents?: boolean }) {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const cents = abs % 100
  const majorStr = major.toLocaleString('en-US')
  const centsStr = opts?.compactCents && cents === 0 ? '' : `.${String(cents).padStart(2, '0')}`
  return `${sign}${CURRENCY_SYMBOL[currency]} ${majorStr}${centsStr}`
}

/** Parse a user-typed decimal string into minor units. Returns null when invalid. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const n = Math.round(parseFloat(cleaned) * 100)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Convert a txn amount to LKR minor units using the manual USD rate. */
export function toLKR(minor: number, currency: Currency, usdRate: number) {
  return currency === 'USD' ? Math.round(minor * usdRate) : minor
}
