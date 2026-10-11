import { db, uid, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, type Category, type CategoryKind } from '../db/db'

/** Sort by manual order; categories without one keep their stored sequence after ordered ones. */
export function sortCats<T extends Pick<Category, 'order'>>(cats: T[]): T[] {
  return cats
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.order ?? 1e6 + a.i) - (b.c.order ?? 1e6 + b.i))
    .map(x => x.c)
}

const MERCHANT_STOPWORDS = new Set(['the', 'pos', 'pvt', 'ltd', 'www', 'com', 'online', 'payment', 'purchase', 'for', 'and'])

/**
 * Rule key for a merchant: its first meaningful word, letters only, so
 * "KEELLS 0042 COLOMBO" and "Keells Kandy" both map to "keells".
 */
export function normalizeMerchant(m: string): string {
  const words = m.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ')
  return words.find(w => w.length >= 3 && !MERCHANT_STOPWORDS.has(w)) ?? ''
}

/** Remember which category a merchant was filed under. */
export async function learnMerchant(merchant: string, categoryId: string): Promise<void> {
  const key = normalizeMerchant(merchant)
  if (!key || !categoryId) return
  await db.merchantRules.put({ merchant: key, categoryId })
}

export async function suggestCategory(merchant: string, kind: CategoryKind): Promise<string | undefined> {
  const key = normalizeMerchant(merchant)
  if (!key) return undefined
  const rule = await db.merchantRules.get(key)
  if (!rule) return undefined
  const cat = await db.categories.get(rule.categoryId)
  return cat && cat.kind === kind ? cat.id : undefined
}

/** The same-kind "Other" bucket, created if it doesn't exist. Call inside a transaction on categories. */
async function otherFor(kind: CategoryKind, excludeId?: string): Promise<Category> {
  const found = (await db.categories.where('kind').equals(kind).toArray()).find(c => c.name === 'Other' && c.id !== excludeId)
  if (found) return found
  const created: Category = { id: uid(), name: 'Other', emoji: kind === 'expense' ? '📦' : '💰', color: '#64748b', kind }
  await db.categories.add(created)
  return created
}

/** Move everything using `fromId` to `toId`. */
async function moveUsage(fromId: string, toId: string) {
  await db.txns.where('categoryId').equals(fromId).modify({ categoryId: toId })
  await db.recurring.filter(r => r.categoryId === fromId).modify({ categoryId: toId })
  await db.merchantRules.filter(r => r.categoryId === fromId).modify({ categoryId: toId })
}

/** Delete a category; its transactions, recurring payments and merchant rules move to "Other". */
export async function deleteCategory(cat: Category): Promise<void> {
  await db.transaction('rw', [db.categories, db.txns, db.recurring, db.merchantRules], async () => {
    const other = await otherFor(cat.kind, cat.id)
    await moveUsage(cat.id, other.id)
    await db.categories.delete(cat.id)
  })
}

/** Merge `from` into `into` (same kind), then delete `from`. */
export async function mergeCategory(from: Category, into: Category): Promise<void> {
  await db.transaction('rw', [db.categories, db.txns, db.recurring, db.merchantRules], async () => {
    await moveUsage(from.id, into.id)
    await db.categories.delete(from.id)
  })
}

/**
 * Startup repair: anything pointing at a category that no longer exists (old
 * deletes, odd restores) is moved to "Other" so it shows up properly in Stats.
 * Returns how many records were fixed.
 */
export async function repairOrphans(): Promise<number> {
  return db.transaction('rw', [db.categories, db.txns, db.recurring, db.merchantRules], async () => {
    const ids = new Set((await db.categories.toArray()).map(c => c.id))
    let fixed = 0
    const orphanTxns = await db.txns.filter(t => t.type !== 'transfer' && !t.adjustment && !ids.has(t.categoryId)).toArray()
    for (const kind of ['expense', 'income'] as const) {
      const group = orphanTxns.filter(t => t.type === kind)
      if (!group.length) continue
      const other = await otherFor(kind)
      for (const t of group) await db.txns.update(t.id, { categoryId: other.id })
      fixed += group.length
    }
    const orphanRec = await db.recurring.filter(r => !ids.has(r.categoryId)).toArray()
    if (orphanRec.length) {
      const other = await otherFor('expense')
      for (const r of orphanRec) await db.recurring.update(r.id, { categoryId: other.id })
      fixed += orphanRec.length
    }
    await db.merchantRules.filter(r => !ids.has(r.categoryId)).delete()
    return fixed
  })
}

/**
 * Give every category an explicit order. Categories created before ordering existed
 * (stored in random id order) fall back to the default list sequence, then by name.
 */
export async function ensureCategoryOrder(): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const all = await db.categories.toArray()
    for (const kind of ['expense', 'income'] as const) {
      const group = all.filter(c => c.kind === kind)
      if (group.every(c => c.order != null)) continue
      const defaults = (kind === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES).map(c => c.name)
      const rank = (c: Category) => (c.order != null ? c.order : 1000 + (defaults.includes(c.name) ? defaults.indexOf(c.name) : 500) )
      const sorted = [...group].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      for (let i = 0; i < sorted.length; i++) await db.categories.update(sorted[i].id, { order: i })
    }
  })
}
