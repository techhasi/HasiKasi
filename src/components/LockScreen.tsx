import { useEffect, useRef, useState } from 'react'
import { verifyLock } from '../lib/appLock'

export default function LockScreen({ credentialId, onUnlock }: { credentialId: string; onUnlock: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const attempted = useRef(false)

  async function unlock() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (await verifyLock(credentialId)) onUnlock()
      else setError('Authentication failed — try again')
    } catch {
      setError('Face ID unavailable or cancelled')
    } finally {
      setBusy(false)
    }
  }

  // One automatic attempt on mount
  useEffect(() => {
    if (!attempted.current) {
      attempted.current = true
      unlock()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b1121] px-8 text-center text-white">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 text-4xl shadow-xl shadow-indigo-500/30">
        🔒
      </div>
      <h1 className="mb-1 text-xl font-bold">HasiKasi is locked</h1>
      <p className="mb-6 text-sm text-slate-400">Unlock with Face ID to continue</p>

      {error && <p className="mb-4 text-sm font-medium text-rose-400">{error}</p>}

      <button
        onClick={unlock}
        disabled={busy}
        className="rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 px-8 py-3.5 font-bold shadow-lg shadow-indigo-500/30 transition-transform active:scale-95 disabled:opacity-50"
      >
        {busy ? 'Checking…' : '🪪 Unlock'}
      </button>
    </div>
  )
}
