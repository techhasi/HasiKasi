import { db } from '../db/db'
import { blobToDataURL, dataURLToBlob } from './image'

interface BackupFile {
  app: 'budgeting-app'
  version: 1
  exportedAt: string
  txns: unknown[]
  categories: unknown[]
  accounts: unknown[]
  periods: unknown[]
  settings: unknown[]
  recurring?: unknown[]
  investments?: unknown[]
  tasks?: unknown[]
  taskLists?: unknown[]
  reminders?: unknown[]
  merchantRules?: unknown[]
  receipts: { txnId: string; dataUrl: string }[]
}

export async function buildBackup(): Promise<BackupFile> {
  const receipts = await db.receipts.toArray()
  // Device-specific secrets are excluded: the cloud token (sensitive) and the
  // Face ID lock (its credential wouldn't exist on a restore target device)
  const settings = (await db.settings.toArray()).map(s => ({
    ...s,
    backupToken: undefined,
    lockEnabled: undefined,
    lockCredentialId: undefined,
    geminiApiKey: undefined
  }))
  return {
    app: 'budgeting-app',
    version: 1,
    exportedAt: new Date().toISOString(),
    txns: await db.txns.toArray(),
    categories: await db.categories.toArray(),
    accounts: await db.accounts.toArray(),
    periods: await db.periods.toArray(),
    settings,
    recurring: await db.recurring.toArray(),
    investments: await db.investments.toArray(),
    tasks: await db.tasks.toArray(),
    taskLists: await db.taskLists.toArray(),
    reminders: await db.reminders.toArray(),
    merchantRules: await db.merchantRules.toArray(),
    receipts: await Promise.all(
      receipts.map(async r => ({ txnId: r.txnId, dataUrl: await blobToDataURL(r.blob) }))
    )
  }
}

export async function exportBackup(): Promise<void> {
  const backup = await buildBackup()
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export interface BackupSummary {
  txns: number
  categories: number
  accounts: number
  exportedAt?: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Throws a readable error unless the data looks like a complete HasiKasi backup. */
export function validateBackup(data: unknown): BackupFile {
  if (!isObj(data) || data.app !== 'budgeting-app') throw new Error('Not a HasiKasi backup file')
  for (const key of ['txns', 'categories', 'accounts', 'periods', 'settings', 'receipts'] as const) {
    if (!Array.isArray(data[key])) throw new Error(`Backup is missing "${key}"`)
  }
  const b = data as unknown as BackupFile
  if (b.categories.length === 0 || b.accounts.length === 0 || b.periods.length === 0 || b.settings.length === 0)
    throw new Error('Backup looks incomplete (no categories, accounts, periods or settings)')
  const bad = (rows: unknown[], fields: Record<string, string>) =>
    rows.some(r => !isObj(r) || Object.entries(fields).some(([k, t]) => typeof r[k] !== t))
  if (bad(b.txns, { id: 'string', type: 'string', amountMinor: 'number', date: 'string' })) throw new Error('Backup has malformed transactions')
  if (bad(b.categories, { id: 'string', name: 'string', kind: 'string' })) throw new Error('Backup has malformed categories')
  if (bad(b.accounts, { id: 'string', name: 'string' })) throw new Error('Backup has malformed accounts')
  if (bad(b.periods, { id: 'string', startDate: 'string' })) throw new Error('Backup has malformed budget periods')
  return b
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  return { txns: b.txns.length, categories: b.categories.length, accounts: b.accounts.length, exportedAt: b.exportedAt }
}

/** Read + validate a backup file without touching any data. */
export async function readBackupFile(file: File): Promise<BackupFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('That file is not valid JSON')
  }
  return validateBackup(parsed)
}

export async function importBackup(file: File): Promise<void> {
  return importBackupData(await readBackupFile(file))
}

const SNAPSHOT_ID = 'pre-restore'

export async function getSnapshotInfo(): Promise<{ createdAt: number } | undefined> {
  const s = await db.snapshots.get(SNAPSHOT_ID)
  return s ? { createdAt: s.createdAt } : undefined
}

/** Put everything back the way it was before the last restore. */
export async function undoLastRestore(): Promise<void> {
  const snap = await db.snapshots.get(SNAPSHOT_ID)
  if (!snap) throw new Error('No snapshot to restore')
  const data = validateBackup(JSON.parse(await snap.json.text()))
  await importBackupData(data, { snapshot: false })
  await db.snapshots.delete(SNAPSHOT_ID)
}

export async function importBackupData(input: BackupFile, opts: { snapshot?: boolean } = {}): Promise<void> {
  const backup = validateBackup(input)
  // Safety net first: keep a copy of the current data so a wrong restore can be undone
  if (opts.snapshot !== false) {
    const json = new Blob([JSON.stringify(await buildBackup())], { type: 'application/json' })
    await db.snapshots.put({ id: SNAPSHOT_ID, createdAt: Date.now(), json })
  }
  const receipts = await Promise.all(
    backup.receipts.map(async r => ({ txnId: r.txnId, blob: await dataURLToBlob(r.dataUrl) }))
  )
  // Device-specific secrets are not in backups — carry the current ones across
  const current = await db.settings.get('app')
  await db.transaction(
    'rw',
    [db.txns, db.categories, db.accounts, db.periods, db.settings, db.receipts, db.recurring, db.investments, db.tasks, db.taskLists, db.reminders, db.merchantRules],
    async () => {
      await Promise.all([
        db.txns.clear(), db.categories.clear(), db.accounts.clear(),
        db.periods.clear(), db.settings.clear(), db.receipts.clear(),
        db.recurring.clear(), db.investments.clear(), db.tasks.clear(), db.taskLists.clear(), db.reminders.clear(), db.merchantRules.clear()
      ])
      await db.txns.bulkAdd(backup.txns as never[])
      await db.categories.bulkAdd(backup.categories as never[])
      await db.accounts.bulkAdd(backup.accounts as never[])
      await db.periods.bulkAdd(backup.periods as never[])
      await db.settings.bulkAdd(backup.settings as never[])
      if (backup.recurring) await db.recurring.bulkAdd(backup.recurring as never[])
      if (backup.investments) await db.investments.bulkAdd(backup.investments as never[])
      if (backup.tasks) await db.tasks.bulkAdd(backup.tasks as never[])
      if (backup.taskLists) await db.taskLists.bulkAdd(backup.taskLists as never[])
      if (backup.reminders) await db.reminders.bulkAdd(backup.reminders as never[])
      if (backup.merchantRules) await db.merchantRules.bulkAdd(backup.merchantRules as never[])
      await db.receipts.bulkAdd(receipts)
      if (current) {
        await db.settings.update('app', {
          backupToken: current.backupToken,
          lockEnabled: current.lockEnabled,
          lockCredentialId: current.lockCredentialId,
          geminiApiKey: current.geminiApiKey
        })
      }
    }
  )
}
