import { db, type Priority, type Recurrence, type Task } from '../db/db'
import { addDaysISO, todayISO } from './dates'

export const PRIORITY_META: Record<Priority, { label: string; color: string; flag: string }> = {
  high: { label: 'High', color: '#ef4444', flag: '🔴' },
  medium: { label: 'Medium', color: '#f59e0b', flag: '🟠' },
  low: { label: 'Low', color: '#0ea5e9', flag: '🔵' },
  none: { label: 'None', color: '#94a3b8', flag: '⚪️' }
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 }

function dowOfISO(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() // 0 = Sun
}

/** Next occurrence of a recurring task's due date, or null for one-off tasks. */
export function advanceTaskDate(dateISO: string, rec: Recurrence): string | null {
  if (rec === 'none' || !dateISO) return null
  if (rec === 'daily') return addDaysISO(dateISO, 1)
  if (rec === 'weekly') return addDaysISO(dateISO, 7)
  if (rec === 'weekdays') {
    let next = addDaysISO(dateISO, 1)
    while (dowOfISO(next) === 0 || dowOfISO(next) === 6) next = addDaysISO(next, 1)
    return next
  }
  // monthly — same day next month, clamped to month length
  const [y, m, d] = dateISO.split('-').map(Number)
  const year = m === 12 ? y + 1 : y
  const month = m === 12 ? 1 : m + 1
  const lastDay = new Date(year, month, 0).getDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Toggle completion. Completing a recurring task rolls it to the next date and
 * resets its subtasks instead of marking it permanently done.
 */
export async function toggleTask(task: Task): Promise<void> {
  if (task.done) {
    await db.tasks.update(task.id, { done: false, completedAt: undefined })
    return
  }
  if (task.recurrence !== 'none' && task.dueDate) {
    const next = advanceTaskDate(task.dueDate, task.recurrence)
    await db.tasks.update(task.id, {
      dueDate: next ?? undefined,
      subtasks: task.subtasks.map(s => ({ ...s, done: false }))
    })
  } else {
    await db.tasks.update(task.id, { done: true, completedAt: Date.now() })
  }
}

export function isOverdue(t: Task): boolean {
  return !t.done && !!t.dueDate && t.dueDate < todayISO()
}

/** Sort incomplete-first, then overdue/soonest due, then priority, then manual order. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    const ad = a.dueDate ?? '9999-99-99'
    const bd = b.dueDate ?? '9999-99-99'
    if (ad !== bd) return ad < bd ? -1 : 1
    if (a.dueTime !== b.dueTime) return (a.dueTime ?? '99:99') < (b.dueTime ?? '99:99') ? -1 : 1
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    return a.order - b.order
  })
}

export function subtaskProgress(t: Task): { done: number; total: number } {
  return { done: t.subtasks.filter(s => s.done).length, total: t.subtasks.length }
}
