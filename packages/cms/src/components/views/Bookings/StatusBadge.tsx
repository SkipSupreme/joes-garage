'use client'
import React from 'react'
import type { BookingStatus } from './useBookings'

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string; textDecoration?: string }> = {
  hold: { bg: 'rgba(156,163,175,0.2)', color: '#9CA3AF', label: 'Hold' },
  paid: { bg: 'rgba(59,130,246,0.2)', color: '#3B82F6', label: 'Paid' },
  active: { bg: 'rgba(16,185,129,0.2)', color: '#10B981', label: 'Active' },
  overdue: { bg: 'rgba(239,68,68,0.2)', color: '#EF4444', label: 'Overdue' },
  completed: { bg: 'rgba(107,114,128,0.2)', color: '#6B7280', label: 'Completed' },
  cancelled: { bg: 'rgba(209,213,219,0.15)', color: '#D1D5DB', label: 'Cancelled', textDecoration: 'line-through' },
}

interface StatusBadgeProps {
  status: BookingStatus | string
  isOverdue?: boolean
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, isOverdue }) => {
  const effectiveStatus = isOverdue && status === 'active' ? 'overdue' : status
  const style = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.hold

  return (
    <span className="status-badge" style={{
      '--badge-bg': style.bg,
      '--badge-color': style.color,
      textDecoration: style.textDecoration || 'none',
    } as React.CSSProperties}>
      <span className="status-badge__dot" style={{ background: style.color }} />
      {style.label}
    </span>
  )
}
