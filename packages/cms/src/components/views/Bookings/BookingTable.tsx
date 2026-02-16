'use client'
import React, { useState, useEffect, useRef } from 'react'
import type { Booking, StatusFilter, DateFilter } from './useBookings'
import { StatusBadge } from './StatusBadge'

const DURATION_LABELS: Record<string, string> = {
  '2h': '2 Hours',
  '4h': '4 Hours',
  '8h': 'Full Day',
  'multi-day': 'Multi-Day',
}

interface FilterConfig {
  label: string
  status: StatusFilter
  date: DateFilter
}

const FILTERS: FilterConfig[] = [
  { label: 'All', status: 'all', date: 'all' },
  { label: 'Today', status: 'all', date: 'today' },
  { label: 'Upcoming', status: 'all', date: 'upcoming' },
  { label: 'Active', status: 'active', date: 'all' },
  { label: 'Overdue', status: 'overdue', date: 'all' },
  { label: 'Completed', status: 'completed', date: 'all' },
]

/**
 * Parse PostgreSQL tstzrange format: ["2026-02-27 16:00:00+00","2026-02-27 20:00:00+00")
 * Returns [startDate, endDate] or [null, null] on failure.
 */
function parseTstzrange(range: string): [Date | null, Date | null] {
  if (!range) return [null, null]
  // Remove brackets: [ or ( at start, ) or ] at end
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

function formatDateTime(date: Date | null): string {
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

function formatDateOnly(date: Date | null): string {
  if (!date) return '-'
  return date.toLocaleDateString('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
  })
}

/** Group items by bike_type and count them, e.g. "Mountain x2, Road x1" */
function summarizeBikes(items: Booking['items']): string {
  const groups: Record<string, number> = {}
  for (const item of items) {
    const key = item.bike_type || 'Bike'
    groups[key] = (groups[key] || 0) + 1
  }
  return Object.entries(groups)
    .map(([type, count]) => (count > 1 ? `${type} x${count}` : type))
    .join(', ')
}

interface BookingTableProps {
  bookings: Booking[]
  loading: boolean
  total: number
  pages: number
  currentPage: number
  statusFilter: StatusFilter
  dateFilter: DateFilter
  search: string
  selectedId: string | null
  onSelect: (booking: Booking) => void
  onSetStatus: (s: StatusFilter) => void
  onSetDate: (d: DateFilter) => void
  onSetSearch: (s: string) => void
  onSetPage: (p: number) => void
}

export const BookingTable: React.FC<BookingTableProps> = ({
  bookings,
  loading,
  total,
  pages,
  currentPage,
  statusFilter,
  dateFilter,
  search,
  selectedId,
  onSelect,
  onSetStatus,
  onSetDate,
  onSetSearch,
  onSetPage,
}) => {
  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  const handleSearch = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSetSearch(value)
    }, 300)
  }

  const activeFilterIdx = FILTERS.findIndex(
    (f) => f.status === statusFilter && f.date === dateFilter,
  )

  return (
    <div className="booking-table-wrapper">
      {/* Search */}
      <input
        type="text"
        className="booking-search"
        placeholder="Search by name, email, phone, or booking ID..."
        value={searchInput}
        onChange={(e) => handleSearch(e.target.value)}
      />

      {/* Filter chips */}
      <div className="filter-chips">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            className={`filter-chip ${i === activeFilterIdx ? 'filter-chip--active' : ''}`}
            onClick={() => {
              onSetStatus(f.status)
              onSetDate(f.date)
            }}
            type="button"
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="booking-table-scroll">
        <table className="booking-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Customer</th>
              <th>Bikes</th>
              <th>Duration</th>
              <th>Pickup</th>
              <th>Return</th>
              <th>Waivers</th>
            </tr>
          </thead>
          <tbody>
            {loading && bookings.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="booking-table__skeleton-row">
                  <td colSpan={7}>
                    <div className="skeleton-line" />
                  </td>
                </tr>
              ))
            ) : bookings.length === 0 ? (
              <tr>
                <td colSpan={7} className="booking-table__empty">
                  No bookings found
                </td>
              </tr>
            ) : (
              bookings.map((booking) => {
                const [start, end] = parseTstzrange(booking.rental_period)
                const waiversSigned = booking.waivers?.filter((w) => w.signed_at).length || 0
                const totalWaivers = booking.item_count || 0

                return (
                  <tr
                    key={booking.id}
                    className={`booking-table__row ${selectedId === booking.id ? 'booking-table__row--selected' : ''}`}
                    onClick={() => onSelect(booking)}
                  >
                    <td>
                      <StatusBadge status={booking.status} isOverdue={booking.is_overdue} />
                    </td>
                    <td className="booking-table__customer">
                      <span className="booking-table__customer-name">{booking.customer_name || 'Unknown'}</span>
                      {booking.source === 'walk-in' && (
                        <span className="booking-table__source-tag">walk-in</span>
                      )}
                    </td>
                    <td>{summarizeBikes(booking.items || [])}</td>
                    <td>{DURATION_LABELS[booking.duration_type] || booking.duration_type}</td>
                    <td>{formatDateTime(start)}</td>
                    <td>{formatDateTime(end)}</td>
                    <td>
                      <span className={waiversSigned >= totalWaivers && totalWaivers > 0 ? 'waiver-ok' : 'waiver-pending'}>
                        {totalWaivers > 0 ? `${waiversSigned}/${totalWaivers}` : '-'}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="pagination">
          <button
            className="pagination__btn"
            disabled={currentPage <= 1}
            onClick={() => onSetPage(currentPage - 1)}
            type="button"
          >
            Prev
          </button>
          <div className="pagination__pages">
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => {
                // Show first, last, and pages near current
                if (p === 1 || p === pages) return true
                if (Math.abs(p - currentPage) <= 2) return true
                return false
              })
              .reduce<(number | string)[]>((acc, p, i, arr) => {
                if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) {
                  acc.push('...')
                }
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                typeof p === 'string' ? (
                  <span key={`ellipsis-${i}`} className="pagination__ellipsis">{p}</span>
                ) : (
                  <button
                    key={p}
                    className={`pagination__page ${p === currentPage ? 'pagination__page--active' : ''}`}
                    onClick={() => onSetPage(p)}
                    type="button"
                  >
                    {p}
                  </button>
                ),
              )}
          </div>
          <button
            className="pagination__btn"
            disabled={currentPage >= pages}
            onClick={() => onSetPage(currentPage + 1)}
            type="button"
          >
            Next
          </button>
          <span className="pagination__total">{total} booking{total !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}
