'use client'
import React from 'react'
import type { DashboardAlerts } from './useBookings'

interface AlertBarProps {
  alerts: DashboardAlerts | null
  onSelect: (reservationId: string) => void
}

function timeAgo(dueAt: string): string {
  const due = new Date(dueAt)
  const now = new Date()
  const diffMs = now.getTime() - due.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 60) return `${diffMins}m overdue`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h overdue`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d overdue`
}

export const AlertBar: React.FC<AlertBarProps> = ({ alerts, onSelect }) => {
  if (!alerts) return null

  const hasOverdue = alerts.overdue.length > 0
  const hasUnsigned = alerts.unsigned_waivers.length > 0

  if (!hasOverdue && !hasUnsigned) return null

  return (
    <div className="alert-bar">
      {hasOverdue && (
        <div className="alert-bar__section alert-bar__section--red">
          <span className="alert-bar__icon">!</span>
          <div className="alert-bar__items">
            {alerts.overdue.map((alert, i) => (
              <button
                key={`overdue-${i}`}
                className="alert-bar__item"
                onClick={() => onSelect(alert.reservation_id)}
                type="button"
              >
                <strong>{alert.customer_name}</strong> &mdash; {alert.bike_name} ({timeAgo(alert.due_at)})
              </button>
            ))}
          </div>
        </div>
      )}
      {hasUnsigned && (
        <div className="alert-bar__section alert-bar__section--amber">
          <span className="alert-bar__icon">&#9888;</span>
          <div className="alert-bar__items">
            {alerts.unsigned_waivers.map((alert, i) => (
              <button
                key={`waiver-${i}`}
                className="alert-bar__item"
                onClick={() => onSelect(alert.reservation_id)}
                type="button"
              >
                <strong>{alert.customer_name}</strong> &mdash; {alert.waiver_count}/{alert.item_count} waivers signed
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
