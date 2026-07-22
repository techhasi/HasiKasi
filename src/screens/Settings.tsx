import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Settings } from '../db/db'
import { exportBackup, importBackup } from '../lib/backup'

export default function SettingsScreen() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const importRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')

  if (!settings) return null

  async function update(patch: Partial<Settings>) {
    await db.settings.update('app', patch)
  }

  async function onImport(file: File) {
    try {
      await importBackup(file)
      setMessage('✅ Backup restored')
    } catch (e) {
      setMessage(`❌ ${e instanceof Error ? e.message : 'Import failed'}`)
    }
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Settings</h1>

      <Section title="Preferences">
        <Row label="Default currency" hint="Used when adding transactions">
          <Segmented
            value={settings.currency}
            options={['LKR', 'USD']}
            onChange={v => update({ currency: v as Settings['currency'] })}
          />
        </Row>
        <Row label="Theme">
          <Segmented
            value={settings.theme}
            options={['system', 'light', 'dark']}
            onChange={v => update({ theme: v as Settings['theme'] })}
          />
        </Row>
        <Row label="Carry over balance" hint="Roll leftover money into the next budget month">
          <Toggle checked={settings.carryOver} onChange={v => update({ carryOver: v })} />
        </Row>
        <Row label="USD rate" hint="LKR per 1 USD, used for totals">
          <input
            inputMode="decimal"
            defaultValue={settings.usdRate}
            onBlur={e => {
              const n = parseFloat(e.target.value)
              if (Number.isFinite(n) && n > 0) update({ usdRate: n })
            }}
            className="w-20 rounded-xl border border-slate-200 bg-slate-50 p-2 text-right text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800"
          />
        </Row>
      </Section>

      <Section title="Data">
        <Row label="Export backup" hint="Download all data as a JSON file">
          <button onClick={() => exportBackup()} className="rounded-xl bg-indigo-500 px-3.5 py-2 text-sm font-semibold text-white">
            Export
          </button>
        </Row>
        <Row label="Restore backup" hint="Replaces all current data">
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            hidden
            onChange={e => e.target.files?.[0] && onImport(e.target.files[0])}
          />
          <button
            onClick={() => importRef.current?.click()}
            className="rounded-xl bg-slate-200 px-3.5 py-2 text-sm font-semibold dark:bg-slate-700"
          >
            Import
          </button>
        </Row>
      </Section>

      {message && <p className="mb-4 text-center text-sm font-medium">{message}</p>}

      <p className="pb-4 text-center text-xs text-slate-400">
        My Budget · local-first · your data never leaves this device
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm dark:bg-slate-800/60">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 dark:border-slate-700/50">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Segmented({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex shrink-0 rounded-xl bg-slate-100 p-0.5 dark:bg-slate-700/60">
      {options.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-[10px] px-2.5 py-1.5 text-xs font-semibold capitalize transition-all ${
            value === o ? 'bg-white text-indigo-600 shadow dark:bg-slate-900 dark:text-indigo-400' : 'text-slate-500'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}
