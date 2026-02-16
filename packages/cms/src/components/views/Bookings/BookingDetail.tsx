'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { StatusBadge } from './StatusBadge'

interface DetailItem {
  id: string
  bike_id: number
  rental_period: string
  rental_price: string
  deposit_amount: string
  checked_out_at: string | null
  checked_in_at: string | null
  bike_name: string
  bike_type: string
  bike_size?: string
}

interface DetailWaiver {
  id: string
  signed_at: string | null
  is_minor: boolean
  signer_name?: string
  signer_email?: string
  guardian_name?: string | null
}

interface DetailNote {
  id: string
  text: string
  created_by: string
  created_at: string
}

interface BookingDetailData {
  id: string
  booking_ref: string
  customer_id: string
  rental_period: string
  duration_type: string
  status: string
  source: string
  hold_expires: string | null
  total_amount: string
  deposit_amount: string
  created_at: string
  updated_at: string
  customer_name: string
  customer_email: string
  customer_phone: string
  items: DetailItem[]
  waivers: DetailWaiver[]
  notes: DetailNote[]
  is_overdue: boolean
}

interface BookingDetailProps {
  bookingId: string
  apiUrl: string
  onClose: () => void
  onAction: () => void
}

const DURATION_LABELS: Record<string, string> = {
  '2h': '2 Hours',
  '4h': '4 Hours',
  '8h': 'Full Day',
  'multi-day': 'Multi-Day',
}

function parseTstzrange(range: string): [Date | null, Date | null] {
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

function formatNoteDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export const BookingDetail: React.FC<BookingDetailProps> = ({
  bookingId,
  apiUrl,
  onClose,
  onAction,
}) => {
  const [detail, setDetail] = useState<BookingDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [showExtend, setShowExtend] = useState(false)
  const [extendDateTime, setExtendDateTime] = useState('')

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/api/admin/bookings/${bookingId}`)
      if (!res.ok) throw new Error('Failed to fetch booking details')
      const data = await res.json()
      setDetail(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, bookingId])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const doAction = async (
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) => {
    setActionLoading(true)
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Action failed')
      }
      await fetchDetail()
      onAction()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCheckOut = () => doAction('PATCH', `/api/admin/bookings/${bookingId}/check-out`)
  const handleCheckIn = () => doAction('PATCH', `/api/admin/bookings/${bookingId}/check-in`)
  const handleCancel = () => {
    if (confirm('Are you sure you want to cancel this booking?')) {
      doAction('PATCH', `/api/admin/bookings/${bookingId}/cancel`)
    }
  }
  const handleExtend = () => {
    if (!extendDateTime) return
    const isoDate = new Date(extendDateTime).toISOString()
    doAction('PATCH', `/api/admin/bookings/${bookingId}/extend`, { newReturnTime: isoDate })
    setShowExtend(false)
    setExtendDateTime('')
  }
  const handleAddNote = async () => {
    if (!noteText.trim()) return
    await doAction('POST', `/api/admin/bookings/${bookingId}/note`, { text: noteText.trim() })
    setNoteText('')
  }

  const displayRef = detail?.booking_ref || bookingId.slice(0, 8).toUpperCase()
  const [start, end] = detail ? parseTstzrange(detail.rental_period) : [null, null]

  return (
    <div className="booking-detail">
      {/* Header */}
      <div className="booking-detail__header">
        <div className="booking-detail__header-left">
          <h2 className="booking-detail__ref">#{displayRef}</h2>
          {detail && (
            <>
              <StatusBadge status={detail.status} isOverdue={detail.is_overdue} />
              {detail.source === 'walk-in' && (
                <span className="booking-detail__source-tag">walk-in</span>
              )}
            </>
          )}
        </div>
        <button className="booking-detail__close" onClick={onClose} type="button">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="booking-detail__loading">Loading...</div>
      ) : error ? (
        <div className="booking-detail__error">{error}</div>
      ) : detail ? (
        <>
          {/* Customer */}
          <div className="booking-detail__section">
            <h3 className="booking-detail__section-title">Customer</h3>
            <div className="booking-detail__field">
              <span className="booking-detail__field-label">Name</span>
              <span className="booking-detail__field-value">{detail.customer_name || 'Unknown'}</span>
            </div>
            {detail.customer_phone && (
              <div className="booking-detail__field">
                <span className="booking-detail__field-label">Phone</span>
                <a href={`tel:${detail.customer_phone}`} className="booking-detail__link">
                  {detail.customer_phone}
                </a>
              </div>
            )}
            {detail.customer_email && !detail.customer_email.includes('@placeholder.local') && (
              <div className="booking-detail__field">
                <span className="booking-detail__field-label">Email</span>
                <span className="booking-detail__field-value">{detail.customer_email}</span>
              </div>
            )}
          </div>

          {/* Booking Info */}
          <div className="booking-detail__section">
            <h3 className="booking-detail__section-title">Booking Info</h3>
            <div className="booking-detail__field">
              <span className="booking-detail__field-label">Duration</span>
              <span className="booking-detail__field-value">
                {DURATION_LABELS[detail.duration_type] || detail.duration_type}
              </span>
            </div>
            <div className="booking-detail__field">
              <span className="booking-detail__field-label">Pickup</span>
              <span className="booking-detail__field-value">{formatDateTime(start)}</span>
            </div>
            <div className="booking-detail__field">
              <span className="booking-detail__field-label">Return</span>
              <span className="booking-detail__field-value">{formatDateTime(end)}</span>
            </div>
            <div className="booking-detail__field">
              <span className="booking-detail__field-label">Total</span>
              <span className="booking-detail__field-value">${parseFloat(detail.total_amount || '0').toFixed(2)}</span>
            </div>
            {detail.deposit_amount && parseFloat(detail.deposit_amount) > 0 && (
              <div className="booking-detail__field">
                <span className="booking-detail__field-label">Deposit</span>
                <span className="booking-detail__field-value">${parseFloat(detail.deposit_amount).toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="booking-detail__section">
            <h3 className="booking-detail__section-title">
              Bikes ({detail.items.length})
            </h3>
            <div className="booking-detail__items">
              {detail.items.map((item) => (
                <div key={item.id} className="booking-detail__item">
                  <div className="booking-detail__item-top">
                    <span className="booking-detail__item-name">{item.bike_name}</span>
                    <span className="booking-detail__item-type">{item.bike_type}</span>
                  </div>
                  <div className="booking-detail__item-meta">
                    <span>${parseFloat(item.rental_price || '0').toFixed(2)}</span>
                    {item.deposit_amount && parseFloat(item.deposit_amount) > 0 && (
                      <span className="booking-detail__item-deposit">
                        +${parseFloat(item.deposit_amount).toFixed(2)} deposit
                      </span>
                    )}
                  </div>
                  <div className="booking-detail__item-status">
                    {item.checked_out_at ? (
                      <span className="booking-detail__check booking-detail__check--out">
                        Checked out {formatDateTime(new Date(item.checked_out_at))}
                      </span>
                    ) : (
                      <span className="booking-detail__check booking-detail__check--pending">
                        Not checked out
                      </span>
                    )}
                    {item.checked_in_at ? (
                      <span className="booking-detail__check booking-detail__check--in">
                        Returned {formatDateTime(new Date(item.checked_in_at))}
                      </span>
                    ) : item.checked_out_at ? (
                      <span className="booking-detail__check booking-detail__check--pending">
                        Not returned
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Waivers */}
          <div className="booking-detail__section">
            <h3 className="booking-detail__section-title">
              Waivers ({detail.waivers.filter((w) => w.signed_at).length}/{detail.items.length})
            </h3>
            {detail.waivers.length > 0 ? (
              <div className="booking-detail__waivers">
                {detail.waivers.map((w) => (
                  <div
                    key={w.id}
                    className={`booking-detail__waiver ${w.signed_at ? 'booking-detail__waiver--signed' : 'booking-detail__waiver--pending'}`}
                  >
                    <span className="booking-detail__waiver-icon">
                      {w.signed_at ? '\u2713' : '\u2717'}
                    </span>
                    <span className="booking-detail__waiver-name">
                      {w.signer_name || 'Rider'}
                      {w.is_minor ? ' (Minor)' : ''}
                      {w.guardian_name ? ` - Guardian: ${w.guardian_name}` : ''}
                    </span>
                    {w.signed_at && (
                      <span className="booking-detail__waiver-date">
                        {formatNoteDate(w.signed_at)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="booking-detail__muted">No waivers yet</p>
            )}
          </div>

          {/* Notes */}
          <div className="booking-detail__section">
            <h3 className="booking-detail__section-title">Notes</h3>
            {detail.notes.length > 0 ? (
              <div className="booking-detail__notes">
                {detail.notes.map((note) => (
                  <div key={note.id} className="booking-detail__note">
                    <div className="booking-detail__note-header">
                      <span className="booking-detail__note-by">{note.created_by}</span>
                      <span className="booking-detail__note-date">
                        {formatNoteDate(note.created_at)}
                      </span>
                    </div>
                    <p className="booking-detail__note-text">{note.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="booking-detail__muted">No notes yet</p>
            )}

            {/* Add note */}
            <div className="booking-detail__add-note">
              <textarea
                className="booking-detail__note-input"
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
              />
              <button
                className="booking-detail__note-submit"
                onClick={handleAddNote}
                disabled={actionLoading || !noteText.trim()}
                type="button"
              >
                Add Note
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="booking-detail__actions">
            {(detail.status === 'hold' || detail.status === 'paid') && (
              <>
                <button
                  className="booking-detail__action-btn booking-detail__action-btn--primary"
                  onClick={handleCheckOut}
                  disabled={actionLoading}
                  type="button"
                >
                  Check Out All
                </button>
                <button
                  className="booking-detail__action-btn booking-detail__action-btn--danger"
                  onClick={handleCancel}
                  disabled={actionLoading}
                  type="button"
                >
                  Cancel
                </button>
              </>
            )}
            {detail.status === 'active' && (
              <>
                <button
                  className="booking-detail__action-btn booking-detail__action-btn--primary"
                  onClick={handleCheckIn}
                  disabled={actionLoading}
                  type="button"
                >
                  Check In All
                </button>
                {!showExtend ? (
                  <button
                    className="booking-detail__action-btn booking-detail__action-btn--secondary"
                    onClick={() => setShowExtend(true)}
                    disabled={actionLoading}
                    type="button"
                  >
                    Extend
                  </button>
                ) : (
                  <div className="booking-detail__extend-form">
                    <input
                      type="datetime-local"
                      className="booking-detail__extend-input"
                      value={extendDateTime}
                      onChange={(e) => setExtendDateTime(e.target.value)}
                    />
                    <button
                      className="booking-detail__action-btn booking-detail__action-btn--primary"
                      onClick={handleExtend}
                      disabled={actionLoading || !extendDateTime}
                      type="button"
                    >
                      Confirm
                    </button>
                    <button
                      className="booking-detail__action-btn booking-detail__action-btn--secondary"
                      onClick={() => { setShowExtend(false); setExtendDateTime('') }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
