'use client'
import React from 'react'
import type { DashboardStats } from './useBookings'

interface KPICardsProps {
  stats: DashboardStats | null
  loading: boolean
}

export const KPICards: React.FC<KPICardsProps> = ({ stats, loading }) => {
  if (loading || !stats) {
    return (
      <div className="kpi-cards">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi-card kpi-card--skeleton">
            <span className="kpi-card__value-skeleton" />
            <span className="kpi-card__label-skeleton" />
          </div>
        ))}
      </div>
    )
  }

  const cards = [
    {
      label: 'Active Rentals',
      value: stats.active_rentals,
      color: '#10B981',
    },
    {
      label: 'Returns Due Today',
      value: stats.returns_due_today,
      color: '#3B82F6',
    },
    {
      label: 'Overdue',
      value: stats.overdue_count,
      color: stats.overdue_count > 0 ? '#EF4444' : '#6B7280',
    },
    {
      label: 'Available Fleet',
      value: `${stats.available_fleet}/${stats.total_fleet}`,
      color: '#8B5CF6',
    },
  ]

  return (
    <div className="kpi-cards">
      {cards.map((card) => (
        <div
          key={card.label}
          className="kpi-card"
          style={{ '--card-color': card.color } as React.CSSProperties}
        >
          <span className="kpi-card__value">{card.value}</span>
          <span className="kpi-card__label">{card.label}</span>
        </div>
      ))}
    </div>
  )
}
