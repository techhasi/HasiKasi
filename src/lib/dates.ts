export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Jul 22" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

/** "Today" / "Yesterday" / "Tue, Jul 22" */
export function friendlyDate(iso: string): string {
  const today = todayISO()
  if (iso === today) return 'Today'
  if (iso === addDaysISO(today, -1)) return 'Yesterday'
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${DAYS[date.getDay()]}, ${MONTHS[m - 1]} ${d}`
}

/** "Jun 26 – Jul 25" or "Jul 1 – now" */
export function periodLabel(start: string, end: string | null): string {
  return `${shortDate(start)} – ${end ? shortDate(end) : 'now'}`
}
