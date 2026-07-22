import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, initDb, DEFAULT_SETTINGS } from './db/db'
import Dashboard from './screens/Dashboard'
import Stats from './screens/Stats'
import Accounts from './screens/Accounts'
import SettingsScreen from './screens/Settings'
import AddSheet from './components/AddSheet'

type Tab = 'home' | 'stats' | 'accounts' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'accounts', label: 'Accounts', icon: '💳' },
  { id: 'settings', label: 'Settings', icon: '⚙️' }
]

export default function App() {
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('home')
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    initDb().then(() => setReady(true))
  }, [])

  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)

  // Apply theme
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const apply = (dark: boolean) => root.classList.toggle('dark', dark)
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches)
      const fn = (e: MediaQueryListEvent) => apply(e.matches)
      mq.addEventListener('change', fn)
      return () => mq.removeEventListener('change', fn)
    }
    apply(settings.theme === 'dark')
  }, [settings?.theme, settings])

  if (!ready) return null

  return (
    <div className="mx-auto max-w-lg min-h-dvh pb-28">
      <main className="pt-safe">
        {tab === 'home' && <Dashboard />}
        {tab === 'stats' && <Stats />}
        {tab === 'accounts' && <Accounts />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-lg -translate-x-1/2 pb-safe">
        <div className="relative mx-4 mb-1 flex items-center justify-between rounded-3xl border border-slate-200/60 bg-white/80 px-2 py-2 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80">
          {TABS.slice(0, 2).map(t => (
            <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
          {/* Add button */}
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Add transaction"
            className="flex h-14 w-14 shrink-0 -translate-y-4 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-3xl font-light text-white shadow-lg shadow-indigo-500/40 transition-transform active:scale-90"
          >
            +
          </button>
          {TABS.slice(2).map(t => (
            <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
        </div>
      </nav>

      {addOpen && <AddSheet onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function TabButton({ tab, active, onClick }: { tab: { label: string; icon: string }; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 transition-colors ${
        active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'
      }`}
    >
      <span className={`text-xl transition-transform ${active ? 'scale-110' : 'grayscale opacity-70'}`}>{tab.icon}</span>
      <span className="text-[10px] font-semibold">{tab.label}</span>
    </button>
  )
}
