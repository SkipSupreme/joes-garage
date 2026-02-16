'use client'
import React, { useState, useEffect, useCallback } from 'react'

interface FleetType {
  type: string
  total: number
  available: number
  rented_out: number
  reserved: number
  maintenance: number
}

interface FleetStatusProps {
  apiUrl: string
  visible: boolean
}

export const FleetStatus: React.FC<FleetStatusProps> = ({ apiUrl, visible }) => {
  const [fleet, setFleet] = useState<FleetType[]>([])
  const [loading, setLoading] = useState(true)

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/fleet`)
      if (!res.ok) throw new Error('Failed to fetch fleet')
      const data = await res.json()
      setFleet(data.fleet || [])
    } catch (err) {
      console.error('Fleet fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    if (visible) {
      fetchFleet()
    }
  }, [visible, fetchFleet])

  if (!visible) return null

  return (
    <div className="fleet-status">
      <h3 className="fleet-status__title">Fleet Status</h3>
      {loading ? (
        <div className="fleet-status__loading">Loading fleet data...</div>
      ) : fleet.length === 0 ? (
        <div className="fleet-status__empty">No fleet data</div>
      ) : (
        <div className="fleet-status__grid">
          {fleet.map((ft) => {
            const availPct = ft.total > 0 ? (ft.available / ft.total) * 100 : 0
            const reservedPct = ft.total > 0 ? (ft.reserved / ft.total) * 100 : 0
            const rentedPct = ft.total > 0 ? (ft.rented_out / ft.total) * 100 : 0
            const maintPct = ft.total > 0 ? (ft.maintenance / ft.total) * 100 : 0

            return (
              <div key={ft.type} className="fleet-status__item">
                <div className="fleet-status__item-header">
                  <span className="fleet-status__type-name">{ft.type}</span>
                  <span className="fleet-status__type-count">
                    {ft.available}/{ft.total} available
                  </span>
                </div>
                <div className="fleet-bar">
                  {availPct > 0 && (
                    <div
                      className="fleet-bar__segment fleet-bar__segment--available"
                      style={{ width: `${availPct}%` }}
                      title={`Available: ${ft.available}`}
                    />
                  )}
                  {reservedPct > 0 && (
                    <div
                      className="fleet-bar__segment fleet-bar__segment--reserved"
                      style={{ width: `${reservedPct}%` }}
                      title={`Reserved: ${ft.reserved}`}
                    />
                  )}
                  {rentedPct > 0 && (
                    <div
                      className="fleet-bar__segment fleet-bar__segment--rented"
                      style={{ width: `${rentedPct}%` }}
                      title={`Rented: ${ft.rented_out}`}
                    />
                  )}
                  {maintPct > 0 && (
                    <div
                      className="fleet-bar__segment fleet-bar__segment--maintenance"
                      style={{ width: `${maintPct}%` }}
                      title={`Maintenance: ${ft.maintenance}`}
                    />
                  )}
                </div>
                <div className="fleet-status__legend">
                  <span className="fleet-status__legend-item">
                    <span className="fleet-status__legend-dot fleet-status__legend-dot--available" />
                    Avail {ft.available}
                  </span>
                  <span className="fleet-status__legend-item">
                    <span className="fleet-status__legend-dot fleet-status__legend-dot--reserved" />
                    Rsv {ft.reserved}
                  </span>
                  <span className="fleet-status__legend-item">
                    <span className="fleet-status__legend-dot fleet-status__legend-dot--rented" />
                    Out {ft.rented_out}
                  </span>
                  {ft.maintenance > 0 && (
                    <span className="fleet-status__legend-item">
                      <span className="fleet-status__legend-dot fleet-status__legend-dot--maintenance" />
                      Maint {ft.maintenance}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
