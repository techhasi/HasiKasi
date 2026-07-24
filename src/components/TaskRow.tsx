import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Task } from '../db/db'
import { PRIORITY_META, isOverdue, subtaskProgress } from '../lib/tasks'
import { friendlyDate } from '../lib/dates'

export default function TaskRow({ task, onToggle, onOpen }: { task: Task; onToggle: () => void; onOpen: () => void }) {
  const list = useLiveQuery(() => (task.listId ? db.taskLists.get(task.listId) : undefined), [task.listId])
  const sub = subtaskProgress(task)
  const overdue = isOverdue(task)

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-800/60">
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 text-xs transition-colors ${
          task.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'
        }`}
        style={!task.done && task.priority !== 'none' ? { borderColor: PRIORITY_META[task.priority].color } : undefined}
      >
        {task.done ? '✓' : ''}
      </button>

      {/* Body */}
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className={`truncate text-sm font-medium ${task.done ? 'text-slate-400 line-through' : ''}`}>{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
          {task.dueDate && (
            <span className={overdue ? 'font-semibold text-rose-500' : ''}>
              {friendlyDate(task.dueDate)}
              {task.dueTime && ` · ${task.dueTime}`}
            </span>
          )}
          {task.recurrence !== 'none' && <span>🔁 {task.recurrence}</span>}
          {sub.total > 0 && <span>☑︎ {sub.done}/{sub.total}</span>}
          {list && (
            <span className="rounded-full px-1.5" style={{ backgroundColor: `${list.color}22`, color: list.color }}>
              {list.emoji} {list.name}
            </span>
          )}
        </div>
      </button>

      {task.priority !== 'none' && !task.done && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_META[task.priority].color }} />
      )}
    </div>
  )
}
