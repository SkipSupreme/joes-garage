'use client'
import React, { useState, useEffect } from 'react'
import { adminFetch } from './adminFetch'

interface FleetBike {
  type: string
  total: number
  available: number
}

interface AvailableBike {
  id: number
  name: string
  type: string
  size: string
  bike_ids: number[]
  available_count: number
  rental_price: string
  price2h: string
  price4h: string
  price8h: string
  deposit_amount: string
}

type Duration = '2h' | '4h' | '8h'
type Step = 1 | 2 | 3

import { DURATION_LABELS } from './constants'

interface WalkInModalProps {
  apiUrl: string
  onClose: () => void
  onSuccess: () => void
}

export const WalkInModal: React.FC<WalkInModalProps> = ({ apiUrl, onClose, onSuccess }) => {
  const [step, setStep] = useState<Step>(1)
  const [duration, setDuration] = useState<Duration>('2h')
  const [bikes, setBikes] = useState<AvailableBike[]>([])
  const [selected, setSelected] = useState<Record<string, { count: number; bikeIds: number[] }>>({})
  const [customer, setCustomer] = useState({ fullName: '', phone: '', email: '' })
  const [loading, setLoading] = useState(false)
  const [fetchingBikes, setFetchingBikes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ reservationId: string; bookingRef: string; waiverUrl: string } | null>(null)

  // Waiver linking state (Step 3)
  const [unlinkedWaivers, setUnlinkedWaivers] = useState<Array<{
    waiver_id: string
    full_name: string
    email: string
    phone: string
    signed_at: string
    is_minor: boolean
  }>>([])
  const [selectedWaivers, setSelectedWaivers] = useState<Set<string>>(new Set())
  const [linking, setLinking] = useState(false)
  const [linkMessage, setLinkMessage] = useState<string | null>(null)

  // Fetch available bikes when duration changes
  useEffect(() => {
    const fetchBikes = async () => {
      setFetchingBikes(true)
      try {
        // Use availability endpoint with today's date and the selected duration
        const now = new Date()
        const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })
        const hhStr = now.toLocaleTimeString('en-CA', {
          timeZone: 'America/Edmonton',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })

        let url: string
        if (duration === '8h') {
          url = `${apiUrl}/api/availability?date=${dateStr}&duration=8h`
        } else {
          url = `${apiUrl}/api/availability?date=${dateStr}&duration=${duration}&startTime=${hhStr}`
        }

        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to fetch available bikes')
        const data = await res.json()
        setBikes(data.bikes || [])
      } catch (err: any) {
        console.error('Failed to fetch bikes:', err)
        setBikes([])
      } finally {
        setFetchingBikes(false)
      }
    }

    fetchBikes()
    setSelected({})
  }, [apiUrl, duration])

  const getPriceForDuration = (bike: AvailableBike): number => {
    switch (duration) {
      case '2h': return parseFloat(bike.price2h || '0')
      case '4h': return parseFloat(bike.price4h || '0')
      case '8h': return parseFloat(bike.price8h || '0')
      default: return parseFloat(bike.rental_price || '0')
    }
  }

  const adjustQuantity = (bikeKey: string, bike: AvailableBike, delta: number) => {
    setSelected((prev) => {
      const current = prev[bikeKey]?.count || 0
      const newCount = Math.max(0, Math.min(bike.available_count, current + delta))
      if (newCount === 0) {
        const { [bikeKey]: _, ...rest } = prev
        return rest
      }
      return {
        ...prev,
        [bikeKey]: {
          count: newCount,
          bikeIds: bike.bike_ids.slice(0, newCount),
        },
      }
    })
  }

  const totalBikes = Object.values(selected).reduce((sum, s) => sum + s.count, 0)

  const totalPrice = bikes.reduce((sum, bike) => {
    const key = `${bike.name}-${bike.type}-${bike.size}`
    const count = selected[key]?.count || 0
    return sum + count * getPriceForDuration(bike)
  }, 0)

  const totalDeposit = bikes.reduce((sum, bike) => {
    const key = `${bike.name}-${bike.type}-${bike.size}`
    const count = selected[key]?.count || 0
    return sum + count * parseFloat(bike.deposit_amount || '0')
  }, 0)

  const handleCreate = async () => {
    setLoading(true)
    setError(null)
    try {
      // Build bikes array: one entry per bike ID
      const bikePayload: { bikeId: number }[] = []
      for (const sel of Object.values(selected)) {
        for (const bikeId of sel.bikeIds) {
          bikePayload.push({ bikeId })
        }
      }

      const res = await adminFetch(`${apiUrl}/api/admin/walk-in`, {
        method: 'POST',
        body: JSON.stringify({
          bikes: bikePayload,
          duration,
          customer: {
            fullName: customer.fullName.trim(),
            phone: customer.phone.trim(),
            email: customer.email.trim() || undefined,
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create walk-in')
      }

      const data = await res.json()
      setResult({
        reservationId: data.reservationId,
        bookingRef: data.bookingRef,
        waiverUrl: data.waiverUrl,
      })
      setStep(3)
      onSuccess()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Fetch today's unlinked waivers when walk-in is created
  useEffect(() => {
    if (!result) return
    const fetchUnlinked = async () => {
      try {
        const res = await adminFetch(`${apiUrl}/api/admin/waivers/unlinked`)
        if (res.ok) {
          const data = await res.json()
          setUnlinkedWaivers(data.waivers || [])
        }
      } catch (err) {
        console.error('Failed to fetch unlinked waivers:', err)
      }
    }
    fetchUnlinked()
  }, [result, apiUrl])

  const handleLinkWaivers = async () => {
    if (selectedWaivers.size === 0 || !result) return
    setLinking(true)
    try {
      const res = await adminFetch(`${apiUrl}/api/admin/bookings/${result.reservationId}/link-waivers`, {
        method: 'PATCH',
        body: JSON.stringify({ waiverIds: Array.from(selectedWaivers) }),
      })
      if (!res.ok) throw new Error('Failed to link waivers')
      const data = await res.json()
      setLinkMessage(data.message)
      setUnlinkedWaivers((prev) => prev.filter((w) => !selectedWaivers.has(w.waiver_id)))
      setSelectedWaivers(new Set())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="walk-in-modal">
      <div className="walk-in-modal__backdrop" onClick={onClose} />
      <div className="walk-in-modal__content">
        <div className="walk-in-modal__header">
          <h2 className="walk-in-modal__title">New Walk-in Rental</h2>
          <button className="walk-in-modal__close" onClick={onClose} type="button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="walk-in-modal__steps">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`walk-in-modal__step ${step >= s ? 'walk-in-modal__step--active' : ''} ${step === s ? 'walk-in-modal__step--current' : ''}`}
            >
              <span className="walk-in-modal__step-num">{s}</span>
              <span className="walk-in-modal__step-label">
                {s === 1 ? 'Select Bikes' : s === 2 ? 'Customer Info' : 'Confirm'}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="walk-in-modal__error">{error}</div>
        )}

        {/* Step 1: Select bikes + duration */}
        {step === 1 && (
          <div className="walk-in-modal__step-content">
            {/* Duration chips */}
            <div className="walk-in-modal__duration">
              <label className="walk-in-modal__label">Duration</label>
              <div className="filter-chips">
                {(Object.keys(DURATION_LABELS) as Duration[]).map((d) => (
                  <button
                    key={d}
                    className={`filter-chip ${duration === d ? 'filter-chip--active' : ''}`}
                    onClick={() => setDuration(d)}
                    type="button"
                  >
                    {DURATION_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            {/* Bike grid */}
            <div className="walk-in-modal__bikes">
              <label className="walk-in-modal__label">Available Bikes</label>
              {fetchingBikes ? (
                <div className="walk-in-modal__bikes-loading">Loading available bikes...</div>
              ) : bikes.length === 0 ? (
                <div className="walk-in-modal__bikes-empty">No bikes available for this duration</div>
              ) : (
                <div className="walk-in-modal__bike-grid">
                  {bikes.map((bike) => {
                    const key = `${bike.name}-${bike.type}-${bike.size}`
                    const count = selected[key]?.count || 0
                    const price = getPriceForDuration(bike)

                    return (
                      <div key={key} className="walk-in-modal__bike-card">
                        <div className="walk-in-modal__bike-info">
                          <span className="walk-in-modal__bike-name">{bike.name}</span>
                          <span className="walk-in-modal__bike-type">{bike.type} {bike.size && `(${bike.size})`}</span>
                          <span className="walk-in-modal__bike-price">${price.toFixed(2)}</span>
                          <span className="walk-in-modal__bike-avail">{bike.available_count} available</span>
                        </div>
                        <div className="walk-in-modal__bike-qty">
                          <button
                            className="walk-in-modal__qty-btn"
                            onClick={() => adjustQuantity(key, bike, -1)}
                            disabled={count === 0}
                            type="button"
                          >
                            -
                          </button>
                          <span className="walk-in-modal__qty-num">{count}</span>
                          <button
                            className="walk-in-modal__qty-btn"
                            onClick={() => adjustQuantity(key, bike, 1)}
                            disabled={count >= bike.available_count}
                            type="button"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Running total */}
            <div className="walk-in-modal__total-bar">
              <div>
                <strong>{totalBikes}</strong> bike{totalBikes !== 1 ? 's' : ''} selected
              </div>
              <div>
                <strong>${totalPrice.toFixed(2)}</strong> rental
                {totalDeposit > 0 && <> + <strong>${totalDeposit.toFixed(2)}</strong> deposit</>}
              </div>
            </div>

            <div className="walk-in-modal__nav">
              <button className="walk-in-modal__nav-btn walk-in-modal__nav-btn--secondary" onClick={onClose} type="button">
                Cancel
              </button>
              <button
                className="walk-in-modal__nav-btn walk-in-modal__nav-btn--primary"
                onClick={() => setStep(2)}
                disabled={totalBikes === 0}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Customer info */}
        {step === 2 && (
          <div className="walk-in-modal__step-content">
            <div className="walk-in-modal__form">
              <div className="walk-in-modal__form-field">
                <label className="walk-in-modal__label" htmlFor="walkin-name">Name *</label>
                <input
                  id="walkin-name"
                  type="text"
                  className="walk-in-modal__input"
                  placeholder="Full name"
                  value={customer.fullName}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, fullName: e.target.value }))}
                  required
                />
              </div>
              <div className="walk-in-modal__form-field">
                <label className="walk-in-modal__label" htmlFor="walkin-phone">Phone *</label>
                <input
                  id="walkin-phone"
                  type="tel"
                  className="walk-in-modal__input"
                  placeholder="Phone number"
                  value={customer.phone}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                  required
                />
              </div>
              <div className="walk-in-modal__form-field">
                <label className="walk-in-modal__label" htmlFor="walkin-email">Email (optional)</label>
                <input
                  id="walkin-email"
                  type="email"
                  className="walk-in-modal__input"
                  placeholder="Email address"
                  value={customer.email}
                  onChange={(e) => setCustomer((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>
            </div>

            <div className="walk-in-modal__nav">
              <button className="walk-in-modal__nav-btn walk-in-modal__nav-btn--secondary" onClick={() => setStep(1)} type="button">
                Back
              </button>
              <button
                className="walk-in-modal__nav-btn walk-in-modal__nav-btn--primary"
                onClick={handleCreate}
                disabled={loading || !customer.fullName.trim() || !customer.phone.trim()}
                type="button"
              >
                {loading ? 'Creating...' : 'Create Walk-in'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm + waiver URL */}
        {step === 3 && result && (
          <div className="walk-in-modal__step-content">
            <div className="walk-in-modal__success">
              <div className="walk-in-modal__success-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h3 className="walk-in-modal__success-title">Walk-in Created</h3>
              <p className="walk-in-modal__success-ref">
                Booking #{result.bookingRef}
              </p>
              <div className="walk-in-modal__waiver-section">
                <p className="walk-in-modal__label">Waiver Link</p>
                <code className="walk-in-modal__waiver-url">joes-garage.ca{result.waiverUrl}</code>
                <p className="walk-in-modal__waiver-hint">
                  Tell the customer to visit the link above, or scan the QR code at the counter.
                </p>
              </div>

              {/* Link pre-signed waivers */}
              {unlinkedWaivers.length > 0 && (
                <div className="walk-in-modal__link-waivers">
                  <p className="walk-in-modal__label">Pre-Signed Waivers Available</p>
                  <p className="walk-in-modal__waiver-hint">
                    Select waivers signed today to link to this booking:
                  </p>
                  <div className="walk-in-modal__waiver-list">
                    {unlinkedWaivers.map((w) => (
                      <label key={w.waiver_id} className="walk-in-modal__waiver-item">
                        <input
                          type="checkbox"
                          checked={selectedWaivers.has(w.waiver_id)}
                          onChange={(e) => {
                            setSelectedWaivers((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(w.waiver_id)
                              else next.delete(w.waiver_id)
                              return next
                            })
                          }}
                        />
                        <span className="walk-in-modal__waiver-name">{w.full_name}</span>
                        <span className="walk-in-modal__waiver-time">
                          {new Date(w.signed_at).toLocaleTimeString('en-CA', {
                            timeZone: 'America/Edmonton',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        {w.is_minor && <span className="walk-in-modal__waiver-minor">Minor</span>}
                      </label>
                    ))}
                  </div>
                  <button
                    className="walk-in-modal__nav-btn walk-in-modal__nav-btn--primary"
                    onClick={handleLinkWaivers}
                    disabled={selectedWaivers.size === 0 || linking}
                    type="button"
                    style={{ marginTop: '8px' }}
                  >
                    {linking ? 'Linking...' : `Link ${selectedWaivers.size} Waiver${selectedWaivers.size !== 1 ? 's' : ''}`}
                  </button>
                  {linkMessage && <p className="walk-in-modal__link-success">{linkMessage}</p>}
                </div>
              )}
            </div>

            <div className="walk-in-modal__nav">
              <button
                className="walk-in-modal__nav-btn walk-in-modal__nav-btn--primary"
                onClick={onClose}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
