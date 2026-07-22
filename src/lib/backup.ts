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
  receipts: { txnId: string; dataUrl: string }[]
}

export async function exportBackup(): Promise<void> {
  const receipts = await db.receipts.toArray()
  const backup: BackupFile = {
    app: 'budgeting-app',
    version: 1,
    exportedAt: new Date().toISOString(),
    txns: await db.txns.toArray(),
    categories: await db.categories.toArray(),
    accounts: await db.accounts.toArray(),
    periods: await db.periods.toArray(),
    settings: await db.settings.toArray(),
    receipts: await Promise.all(
      receipts.map(async r => ({ txnId: r.txnId, dataUrl: await blobToDataURL(r.blob) }))
    )
  }
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importBackup(file: File): Promise<void> {
  const backup = JSON.parse(await file.text()) as BackupFile
  if (backup.app !== 'budgeting-app') throw new Error('Not a budget backup file')
  const receipts = await Promise.all(
    backup.receipts.map(async r => ({ txnId: r.txnId, blob: await dataURLToBlob(r.dataUrl) }))
  )
  await db.transaction('rw', [db.txns, db.categories, db.accounts, db.periods, db.settings, db.receipts], async () => {
    await Promise.all([
      db.txns.clear(), db.categories.clear(), db.accounts.clear(),
      db.periods.clear(), db.settings.clear(), db.receipts.clear()
    ])
    await db.txns.bulkAdd(backup.txns as never[])
    await db.categories.bulkAdd(backup.categories as never[])
    await db.accounts.bulkAdd(backup.accounts as never[])
    await db.periods.bulkAdd(backup.periods as never[])
    await db.settings.bulkAdd(backup.settings as never[])
    await db.receipts.bulkAdd(receipts)
  })
}
