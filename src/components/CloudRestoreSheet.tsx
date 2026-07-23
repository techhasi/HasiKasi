import { useEffect, useState } from 'react'
import { listCloudBackups, restoreCloudBackup, type CloudBackupEntry } from '../lib/cloudBackup'
import Sheet from './Sheet'

/** Pick a backup from the cloud repo and restore it. */
export default function CloudRestoreSheet({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CloudBackupEntry[] | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<CloudBackupEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    listCloudBackups()
      .then(setEntries)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to list backups'))
  }, [])

  async function restore(entry: CloudBackupEntry) {
    setBusy(true)
    setError('')
    try {
      await restoreCloudBackup(entry.path)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed')
      setConfirming(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} title="☁️ Restore from cloud">
      {done ? (
        <div className="py-6 text-center">
          <p className="mb-2 text-4xl">✅</p>
          <p className="mb-4 text-sm font-medium">Backup restored successfully.</p>
          <button onClick={onClose} className="rounded-2xl bg-indigo-500 px-8 py-3 font-bold text-white shadow-lg shadow-indigo-500/30">
            Done
          </button>
        </div>
      ) : confirming ? (
        <div className="py-2">
          <p className="mb-1 text-center text-sm font-semibold">Restore “{confirming.label}”?</p>
          <p className="mb-5 text-center text-xs text-rose-500">
            This replaces ALL data currently in the app with the backup's contents.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirming(null)}
              disabled={busy}
              className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={() => restore(confirming)}
              disabled={busy}
              className="flex-1 rounded-2xl bg-rose-500 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Restoring…' : 'Yes, restore'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Backups found in your cloud repo. The daily backup is the freshest; cycle snapshots capture each budget
            month as it started.
          </p>
          {entries === null && !error && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}
          {entries?.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">No backups in the repo yet — run "Back up now" first.</p>
          )}
          {entries && entries.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-800/60">
              {entries.map(e => (
                <button
                  key={e.path}
                  onClick={() => setConfirming(e)}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left last:border-0 active:bg-slate-100 dark:border-slate-700/50 dark:active:bg-slate-700/40"
                >
                  <span className="text-lg">{e.label.startsWith('Latest') ? '🕐' : '📆'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.label}</span>
                    <span className="block text-xs text-slate-400">{e.name} · {e.sizeKb} KB</span>
                  </span>
                  <span className="text-slate-300">›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="mt-3 text-center text-sm font-medium text-rose-500">❌ {error}</p>}
    </Sheet>
  )
}
