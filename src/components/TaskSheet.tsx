import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type Priority, type Recurrence, type Subtask, type Task } from '../db/db'
import { PRIORITY_META } from '../lib/tasks'
import { todayISO } from '../lib/dates'
import Sheet from './Sheet'

const RECURRENCE_OPTS: { id: Recurrence; label: string }[] = [
  { id: 'none', label: 'Once' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' }
]

export default function TaskSheet({
  edit,
  defaultDate,
  defaultListId,
  onClose
}: {
  edit?: Task
  defaultDate?: string
  defaultListId?: string | null
  onClose: () => void
}) {
  const lists = useLiveQuery(() => db.taskLists.orderBy('order').toArray(), [], [])

  const [title, setTitle] = useState(edit?.title ?? '')
  const [notes, setNotes] = useState(edit?.notes ?? '')
  const [dueDate, setDueDate] = useState(edit?.dueDate ?? defaultDate ?? '')
  const [dueTime, setDueTime] = useState(edit?.dueTime ?? '')
  const [priority, setPriority] = useState<Priority>(edit?.priority ?? 'none')
  const [listId, setListId] = useState<string | null>(edit?.listId ?? defaultListId ?? null)
  const [recurrence, setRecurrence] = useState<Recurrence>(edit?.recurrence ?? 'none')
  const [subtasks, setSubtasks] = useState<Subtask[]>(edit?.subtasks ?? [])
  const [newSub, setNewSub] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  function addSub() {
    const t = newSub.trim()
    if (!t) return
    setSubtasks(s => [...s, { id: uid(), title: t, done: false }])
    setNewSub('')
  }

  async function save() {
    if (!title.trim()) return setError('Enter a title')
    if (recurrence !== 'none' && !dueDate) return setError('Repeating tasks need a date')
    const fields = {
      title: title.trim(),
      notes: notes.trim(),
      dueDate: dueDate || undefined,
      dueTime: dueDate && dueTime ? dueTime : undefined,
      priority,
      listId,
      recurrence,
      subtasks
    }
    if (edit) {
      await db.tasks.update(edit.id, fields)
    } else {
      await db.tasks.add({ id: uid(), done: false, order: Date.now(), createdAt: Date.now(), ...fields })
    }
    onClose()
  }

  async function remove() {
    if (edit) await db.tasks.delete(edit.id)
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={edit ? 'Edit task' : 'New task'}>
      <input
        autoFocus={!edit}
        placeholder="What needs doing?"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium dark:border-slate-700 dark:bg-slate-800/60"
      />

      {/* Due date + time */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label>Due date</Label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
        </div>
        <div>
          <Label>Time</Label>
          <input
            type="time"
            value={dueTime}
            disabled={!dueDate}
            onChange={e => setDueTime(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800/60"
          />
        </div>
      </div>
      {dueDate && (
        <div className="mb-3 flex gap-2">
          <Quick label="Today" onClick={() => setDueDate(todayISO())} />
          <button onClick={() => { setDueDate(''); setDueTime('') }} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-800">
            Clear date
          </button>
        </div>
      )}
      {!dueDate && (
        <div className="mb-3">
          <Quick label="+ Add a due date (Today)" onClick={() => setDueDate(todayISO())} />
        </div>
      )}

      {/* Priority */}
      <Label>Priority</Label>
      <div className="mb-3 flex gap-1.5">
        {(['high', 'medium', 'low', 'none'] as Priority[]).map(p => (
          <button
            key={p}
            onClick={() => setPriority(p)}
            className={`flex-1 rounded-xl border-2 py-2 text-xs font-semibold ${
              priority === p ? 'border-current' : 'border-transparent bg-slate-50 dark:bg-slate-800/60'
            }`}
            style={priority === p ? { color: PRIORITY_META[p].color, backgroundColor: `${PRIORITY_META[p].color}18` } : undefined}
          >
            {PRIORITY_META[p].label}
          </button>
        ))}
      </div>

      {/* List */}
      <Label>List</Label>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => setListId(null)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            listId === null ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
          }`}
        >
          📥 Inbox
        </button>
        {lists.map(l => (
          <button
            key={l.id}
            onClick={() => setListId(l.id)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold"
            style={
              listId === l.id
                ? { backgroundColor: l.color, color: '#fff' }
                : { backgroundColor: `${l.color}22`, color: l.color }
            }
          >
            {l.emoji} {l.name}
          </button>
        ))}
      </div>

      {/* Repeat */}
      <Label>Repeat</Label>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {RECURRENCE_OPTS.map(r => (
          <button
            key={r.id}
            onClick={() => setRecurrence(r.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              recurrence === r.id ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Subtasks */}
      <Label>Checklist</Label>
      <div className="mb-2 space-y-1.5">
        {subtasks.map(s => (
          <div key={s.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <button
              onClick={() => setSubtasks(list => list.map(x => (x.id === s.id ? { ...x, done: !x.done } : x)))}
              className={`flex h-5 w-5 items-center justify-center rounded-md border-2 text-[11px] ${
                s.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'
              }`}
            >
              {s.done ? '✓' : ''}
            </button>
            <span className={`flex-1 text-sm ${s.done ? 'text-slate-400 line-through' : ''}`}>{s.title}</span>
            <button onClick={() => setSubtasks(list => list.filter(x => x.id !== s.id))} className="text-slate-400">✕</button>
          </div>
        ))}
      </div>
      <div className="mb-4 flex gap-2">
        <input
          placeholder="Add a checklist item…"
          value={newSub}
          onChange={e => setNewSub(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addSub()}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/60"
        />
        <button onClick={addSub} className="rounded-xl bg-slate-200 px-4 text-sm font-semibold dark:bg-slate-700">Add</button>
      </div>

      {/* Notes */}
      <Label>Notes</Label>
      <textarea
        placeholder="Optional details…"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        className="mb-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      <button onClick={save} className="mb-2 w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        {edit ? 'Save changes' : 'Add task'}
      </button>
      {edit &&
        (confirming ? (
          <div className="flex gap-3">
            <button onClick={() => setConfirming(false)} className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">Cancel</button>
            <button onClick={remove} className="flex-1 rounded-2xl bg-rose-500 py-3 font-semibold text-white">Yes, delete</button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="w-full rounded-2xl bg-rose-50 py-3 font-semibold text-rose-500 dark:bg-rose-500/10">
            Delete task
          </button>
        ))}
    </Sheet>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>
}

function Quick({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
      {label}
    </button>
  )
}
