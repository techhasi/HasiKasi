import Dexie, { type EntityTable } from 'dexie'

export type Currency = 'LKR' | 'USD'
export type TxnType = 'expense' | 'income'
export type Theme = 'system' | 'light' | 'dark'

export interface Category {
  id: string
  name: string
  emoji: string
  color: string
  kind: TxnType
  builtin?: boolean
}

export interface Account {
  id: string
  name: string
  type: 'cash' | 'bank' | 'card'
  color: string
  /** opening balance in LKR minor units (cents) */
  openingMinor: number
}

export interface Txn {
  id: string
  type: TxnType
  /** amount in minor units (cents) of `currency` */
  amountMinor: number
  currency: Currency
  categoryId: string
  accountId: string
  /** ISO date YYYY-MM-DD */
  date: string
  note: string
  /** income only: this txn (salary) started a new budget period */
  startsPeriod?: boolean
  createdAt: number
}

export interface Receipt {
  txnId: string
  blob: Blob
}

export interface Period {
  id: string
  /** ISO date YYYY-MM-DD (inclusive) */
  startDate: string
  /** ISO date YYYY-MM-DD (inclusive), null = currently active */
  endDate: string | null
  /** balance carried in from previous period, LKR minor units */
  carryInMinor: number
}

export interface Settings {
  id: 'app'
  currency: Currency
  theme: Theme
  carryOver: boolean
  /** manual LKR per 1 USD rate used to convert USD txns in totals */
  usdRate: number
}

/** A bank-SMS candidate awaiting user approval in the import inbox. */
export interface PendingTxn {
  id: string
  raw: string
  type: TxnType
  amountMinor: number
  currency: Currency
  date: string
  merchant: string
  accountHint: string | null
  createdAt: number
}

export const db = new Dexie('budget-app') as Dexie & {
  txns: EntityTable<Txn, 'id'>
  categories: EntityTable<Category, 'id'>
  accounts: EntityTable<Account, 'id'>
  receipts: EntityTable<Receipt, 'txnId'>
  periods: EntityTable<Period, 'id'>
  settings: EntityTable<Settings, 'id'>
  pending: EntityTable<PendingTxn, 'id'>
}

db.version(1).stores({
  txns: 'id, date, type, categoryId, accountId',
  categories: 'id, kind',
  accounts: 'id',
  receipts: 'txnId',
  periods: 'id, startDate',
  settings: 'id'
})

db.version(2).stores({
  pending: 'id, createdAt'
})

export const uid = () => crypto.randomUUID()

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  currency: 'LKR',
  theme: 'dark',
  carryOver: true,
  usdRate: 300
}

const DEFAULT_EXPENSE_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Food', emoji: '🍔', color: '#f97316', kind: 'expense', builtin: true },
  { name: 'Groceries', emoji: '🛒', color: '#84cc16', kind: 'expense', builtin: true },
  { name: 'Transport', emoji: '🚕', color: '#eab308', kind: 'expense', builtin: true },
  { name: 'Bills', emoji: '⚡', color: '#06b6d4', kind: 'expense', builtin: true },
  { name: 'Shopping', emoji: '🛍️', color: '#ec4899', kind: 'expense', builtin: true },
  { name: 'Health', emoji: '💊', color: '#ef4444', kind: 'expense', builtin: true },
  { name: 'Entertainment', emoji: '🎬', color: '#8b5cf6', kind: 'expense', builtin: true },
  { name: 'Education', emoji: '📚', color: '#3b82f6', kind: 'expense', builtin: true },
  { name: 'Other', emoji: '📦', color: '#64748b', kind: 'expense', builtin: true }
]

const DEFAULT_INCOME_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Salary', emoji: '💼', color: '#10b981', kind: 'income', builtin: true },
  { name: 'Freelance', emoji: '💻', color: '#6366f1', kind: 'income', builtin: true },
  { name: 'Interest', emoji: '🏦', color: '#0ea5e9', kind: 'income', builtin: true },
  { name: 'Gift', emoji: '🎁', color: '#f43f5e', kind: 'income', builtin: true },
  { name: 'Other', emoji: '💰', color: '#64748b', kind: 'income', builtin: true }
]

/** Seed defaults on first run; safe to call every launch. */
export async function initDb() {
  await db.transaction('rw', [db.categories, db.accounts, db.settings, db.periods], async () => {
    if ((await db.settings.count()) === 0) {
      await db.settings.add(DEFAULT_SETTINGS)
    }
    if ((await db.categories.count()) === 0) {
      await db.categories.bulkAdd(
        [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES].map(c => ({ ...c, id: uid() }))
      )
    }
    if ((await db.accounts.count()) === 0) {
      await db.accounts.add({ id: uid(), name: 'Cash', type: 'cash', color: '#10b981', openingMinor: 0 })
    }
    if ((await db.periods.count()) === 0) {
      // Initial period starts on the 1st of the current month; the first
      // salary entry will close it and start the real salary-cycle.
      const now = new Date()
      const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      await db.periods.add({ id: uid(), startDate: first, endDate: null, carryInMinor: 0 })
    }
  })
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS
}
