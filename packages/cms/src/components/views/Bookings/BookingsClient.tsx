'use client'
import React, { useState } from 'react'
import './bookings.scss'
import { useBookings } from './useBookings'
import type { Booking } from './useBookings'
import { KPICards } from './KPICards'
import { AlertBar } from './AlertBar'
import { BookingTable } from './BookingTable'
import { BookingDetail } from './BookingDetail'
import { WalkInModal } from './WalkInModal'
import { FleetStatus } from './FleetStatus'

interface BookingsClientProps {
  apiUrl: string
}

export const BookingsClient: React.FC<BookingsClientProps> = ({ apiUrl }) => {
  const {
    stats,
    alerts,
    bookings,
    total,
    pages,
    currentPage,
    filters,
    setStatus,
    setDate,
    setSearch,
    setPage,
    loading,
    refresh,
  } = useBookings(apiUrl)

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [showFleet, setShowFleet] = useState(false)

  const handleSelectBooking = (booking: Booking) => {
    setSelectedBooking(booking)
  }

  const handleSelectFromAlert = (reservationId: string) => {
    const found = bookings.find((b) => b.id === reservationId)
    if (found) {
      setSelectedBooking(found)
    } else {
      // If booking isn't in current page, still open the detail panel
      setSelectedBooking({ id: reservationId } as Booking)
    }
  }

  const handleCloseDetail = () => {
    setSelectedBooking(null)
  }

  const handleAction = () => {
    refresh()
  }

  return (
    <div className="bookings-dashboard">
      {/* Header */}
      <div className="bookings-dashboard__header">
        <h1 className="bookings-dashboard__title">Bookings</h1>
        <div className="bookings-dashboard__header-actions">
          <button
            className="bookings-dashboard__fleet-toggle"
            onClick={() => setShowFleet(!showFleet)}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Fleet Status
          </button>
          <button
            className="bookings-dashboard__walk-in-btn"
            onClick={() => setShowWalkIn(true)}
            type="button"
          >
            + New Walk-in
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <KPICards stats={stats} loading={loading} />

      {/* Fleet Status (collapsible) */}
      <FleetStatus apiUrl={apiUrl} visible={showFleet} />

      {/* Alert Bar */}
      <AlertBar alerts={alerts} onSelect={handleSelectFromAlert} />

      {/* Main area */}
      <div className="bookings-dashboard__main">
        <div className={`bookings-dashboard__table-area ${selectedBooking ? 'bookings-dashboard__table-area--with-detail' : ''}`}>
          <BookingTable
            bookings={bookings}
            loading={loading}
            total={total}
            pages={pages}
            currentPage={currentPage}
            statusFilter={filters.status}
            dateFilter={filters.date}
            search={filters.search}
            selectedId={selectedBooking?.id || null}
            onSelect={handleSelectBooking}
            onSetStatus={setStatus}
            onSetDate={setDate}
            onSetSearch={setSearch}
            onSetPage={setPage}
          />
        </div>

        {/* Detail panel */}
        {selectedBooking && (
          <BookingDetail
            bookingId={selectedBooking.id}
            apiUrl={apiUrl}
            onClose={handleCloseDetail}
            onAction={handleAction}
          />
        )}
      </div>

      {/* Walk-in Modal */}
      {showWalkIn && (
        <WalkInModal
          apiUrl={apiUrl}
          onClose={() => setShowWalkIn(false)}
          onSuccess={() => {
            refresh()
          }}
        />
      )}
    </div>
  )
}
