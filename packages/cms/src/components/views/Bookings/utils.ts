/**
 * Parse PostgreSQL tstzrange format: ["2026-02-27 16:00:00+00","2026-02-27 20:00:00+00")
 * Returns [startDate, endDate] or [null, null] on failure.
 */
export function parseTstzrange(range: string): [Date | null, Date | null] {
  if (!range) return [null, null]
  const inner = range.replace(/^[\[\(]/, '').replace(/[\]\)]$/, '')
  const parts = inner.split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
  if (parts.length !== 2) return [null, null]
  const start = new Date(parts[0])
  const end = new Date(parts[1])
  return [
    isNaN(start.getTime()) ? null : start,
    isNaN(end.getTime()) ? null : end,
  ]
}

export function formatDateTime(date: Date | null): string {
  if (!date) return '-'
  return date.toLocaleString('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
