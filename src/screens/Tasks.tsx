import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type Task, type TaskList } from '../db/db'
import { sortTasks, toggleTask, isOverdue } from '../lib/tasks'
import { todayISO, addDaysISO, friendlyDate } from '../lib/dates'
import TaskRow from '../components/TaskRow'
import TaskSheet from '../components/TaskSheet'
import TaskCalendar from '../components/TaskCalendar'
import Sheet from '../components/Sheet'

type View = 'today' | 'upcoming' | 'all' | 'calendar'

const VIEWS: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All' },
  { id: 'calendar', label: 'Calendar' }
]

export default function Tasks({ addOpen, onAddClose }: { addOpen: boolean; onAddClose: () => void }) {
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], [])
  const lists = useLiveQuery(() => db.taskLists.orderBy('order').toArray(), [], [])

  const [view, setView] = useState<View>('today')
  const [listFilter, setListFilter] = useState<string | 'all'>('all')
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [adding, setAdding] = useState(false)
  const [manageLists, setManageLists] = useState(false)

  const today = todayISO()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks.filter(t => {
      if (listFilter !== 'all' && t.listId !== listFilter) return false
      if (q && !(t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))) return false
      return true
    })
  }, [tasks, listFilter, query])

  const openCount = filtered.filter(t => !t.done).length

  const groups = useMemo(() => {
    if (view === 'today') {
      const overdue = sortTasks(filtered.filter(t => isOverdue(t)))
      const dueToday = sortTasks(filtered.filter(t => !t.done && t.dueDate === today))
      const noDate = sortTasks(filtered.filter(t => !t.done && !t.dueDate))
      const done = showDone ? sortTasks(filtered.filter(t => t.done && t.completedAt && t.dueDate === today)) : []
      return [
        { key: 'Overdue', items: overdue, danger: true },
        { key: 'Today', items: dueToday },
        { key: 'No date', items: noDate },
        ...(done.length ? [{ key: 'Completed', items: done }] : [])
      ].filter(g => g.items.length)
    }
    if (view === 'upcoming') {
      const upcoming = filtered.filter(t => !t.done && t.dueDate && t.dueDate > today && t.dueDate <= addDaysISO(today, 30))
      const byDate = new Map<string, Task[]>()
      for (const t of sortTasks(upcoming)) {
        const arr = byDate.get(t.dueDate!) ?? []
        arr.push(t)
        byDate.set(t.dueDate!, arr)
      }
      return [...byDate.entries()].map(([date, items]) => ({ key: friendlyDate(date), items }))
    }
    // all
    const open = sortTasks(filtered.filter(t => !t.done))
    const done = showDone ? sortTasks(filtered.filter(t => t.done)) : []
    return [
      { key: 'To do', items: open },
      ...(done.length ? [{ key: 'Completed', items: done }] : [])
    ].filter(g => g.items.length)
  }, [filtered, view, today, showDone])

  return (
    <div className="px-4 pt-6">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{openCount} open</p>
        </div>
        <button onClick={() => setManageLists(true)} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold shadow-sm dark:bg-slate-800/60">
          🗂 Lists
        </button>
      </div>

      {/* View switch */}
      <div className="mb-3 flex rounded-2xl bg-slate-200/60 p-1 dark:bg-slate-800">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-all ${
              view === v.id ? 'bg-white text-indigo-600 shadow dark:bg-slate-900 dark:text-indigo-400' : 'text-slate-500'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view !== 'calendar' && (
        <>
          {/* Search + list filter */}
          <input
            placeholder="Search tasks…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          <div className="mb-3 flex gap-1.5 overflow-x-auto">
            <Chip active={listFilter === 'all'} onClick={() => setListFilter('all')}>All</Chip>
            {lists.map(l => (
              <Chip key={l.id} active={listFilter === l.id} color={l.color} onClick={() => setListFilter(l.id)}>
                {l.emoji} {l.name}
              </Chip>
            ))}
          </div>
        </>
      )}

      {view === 'calendar' ? (
        <TaskCalendar />
      ) : (
        <>
          {groups.length === 0 && (
            <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-slate-400 dark:border-slate-700">
              <p className="mb-1 text-3xl">✅</p>
              <p className="text-sm">{view === 'today' ? 'All clear for today!' : 'Nothing here yet.'}</p>
              <button onClick={() => setAdding(true)} className="mt-3 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white">
                + Add a task
              </button>
            </div>
          )}
          {groups.map(g => (
            <div key={g.key} className="mb-4">
              <p className={`mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide ${'danger' in g && g.danger ? 'text-rose-500' : 'text-slate-400'}`}>
                {g.key} · {g.items.length}
              </p>
              <div className="space-y-2">
                {g.items.map(t => (
                  <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t)} onOpen={() => setEditing(t)} />
                ))}
              </div>
            </div>
          ))}

          {(view === 'today' || view === 'all') && filtered.some(t => t.done) && (
            <button onClick={() => setShowDone(s => !s)} className="mb-4 w-full rounded-xl bg-slate-100 py-2 text-xs font-semibold text-slate-500 dark:bg-slate-800">
              {showDone ? 'Hide completed' : 'Show completed'}
            </button>
          )}
        </>
      )}

      {editing && <TaskSheet edit={editing} onClose={() => setEditing(null)} />}
      {(adding || addOpen) && (
        <TaskSheet
          defaultListId={listFilter === 'all' ? null : listFilter}
          onClose={() => { setAdding(false); onAddClose() }}
        />
      )}
      {manageLists && <ManageListsSheet lists={lists} onClose={() => setManageLists(false)} />}
    </div>
  )
}

function Chip({ children, active, color, onClick }: { children: React.ReactNode; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
        active && !color ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900' : !active ? 'bg-slate-100 text-slate-500 dark:bg-slate-800' : ''
      }`}
      style={active && color ? { backgroundColor: color, color: '#fff' } : undefined}
    >
      {children}
    </button>
  )
}

const LIST_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

function ManageListsSheet({ lists, onClose }: { lists: TaskList[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('📁')
  const [color, setColor] = useState(LIST_COLORS[0])

  async function add() {
    if (!name.trim()) return
    await db.taskLists.add({ id: uid(), name: name.trim(), emoji: emoji || '📁', color, order: lists.length })
    setName('')
  }

  async function remove(id: string) {
    // Orphan tasks fall back to the inbox
    await db.transaction('rw', [db.taskLists, db.tasks], async () => {
      await db.taskLists.delete(id)
      const orphans = await db.tasks.where('listId').equals(id).toArray()
      for (const t of orphans) await db.tasks.update(t.id, { listId: null })
    })
  }

  return (
    <Sheet onClose={onClose} title="Lists">
      <div className="mb-4 space-y-2">
        {lists.map(l => (
          <div key={l.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: `${l.color}22` }}>{l.emoji}</span>
            <span className="flex-1 text-sm font-medium">{l.name}</span>
            <button onClick={() => remove(l.id)} className="text-sm text-rose-500">Delete</button>
          </div>
        ))}
      </div>

      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">New list</p>
      <div className="mb-2 flex gap-2">
        <input value={emoji} onChange={e => setEmoji(e.target.value.slice(-2))} className="w-12 rounded-xl border border-slate-200 bg-white p-2 text-center text-lg dark:border-slate-700 dark:bg-slate-900" />
        <input placeholder="List name" value={name} onChange={e => setName(e.target.value)} className="flex-1 rounded-xl border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LIST_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ${color === c ? 'scale-125 ring-2 ring-slate-400 ring-offset-1' : ''}`} style={{ backgroundColor: c }} />
        ))}
      </div>
      <button onClick={add} className="w-full rounded-2xl bg-indigo-500 py-3 font-bold text-white">Add list</button>
    </Sheet>
  )
}
