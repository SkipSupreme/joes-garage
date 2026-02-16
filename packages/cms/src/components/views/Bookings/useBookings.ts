'use client'
import { useState, useEffect, useCallback, useRef } from 'react'

export type BookingStatus = 'hold' | 'paid' | 'active' | 'overdue' | 'completed' | 'cancelled'

export interface BookingItem {
  id: string
  bike_id: number
  rental_period: string
  rental_price: string
  deposit_amount: string
  checked_out_at: string | null
  checked_in_at: string | null
  bike_name: string
  bike_type: string
}

export interface BookingWaiver {
  id: string
  signed_at: string | null
  is_minor: boolean
}

export interface Booking {
  id: string
  customer_id: string
  rental_period: string
  duration_type: string
  status: BookingStatus
  source: string
  hold_expires: string | null
  total_amount: string
  deposit_amount: string
  created_at: string
  updated_at: string
  customer_name: string
  customer_email: string
  customer_phone: string
  item_count: number
  waiver_count: number
  items: BookingItem[]
  waivers: BookingWaiver[]
  is_overdue: boolean
}

export interface DashboardStats {
  active_rentals: number
  returns_due_today: number
  overdue_count: number
  available_fleet: number
  total_fleet: number
}

export interface OverdueAlert {
  reservation_id: string
  customer_name: string
  bike_name: string
  due_at: string
}

export interface UnsignedWaiverAlert {
  reservation_id: string
  customer_name: string
  item_count: number
  waiver_count: number
}

export interface DashboardAlerts {
  overdue: OverdueAlert[]
  unsigned_waivers: UnsignedWaiverAlert[]
}

export type StatusFilter = 'all' | 'hold' | 'paid' | 'active' | 'overdue' | 'completed' | 'cancelled'
export type DateFilter = 'all' | 'today' | 'upcoming' | 'past'

interface Filters {
  status: StatusFilter
  date: DateFilter
  search: string
  page: number
}

interface UseBookingsReturn {
  stats: DashboardStats | null
  alerts: DashboardAlerts | null
  bookings: Booking[]
  total: number
  pages: number
  currentPage: number
  filters: Filters
  setStatus: (s: StatusFilter) => void
  setDate: (d: DateFilter) => void
  setSearch: (s: string) => void
  setPage: (p: number) => void
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useBookings(apiUrl: string): UseBookingsReturn {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [alerts, setAlerts] = useState<DashboardAlerts | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filters, setFilters] = useState<Filters>({
    status: 'all',
    date: 'all',
    search: '',
    page: 1,
  })

  const refreshRef = useRef(0)

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/dashboard`)
      if (!res.ok) throw new Error('Failed to fetch dashboard')
      const data = await res.json()
      setStats(data.stats)
      setAlerts(data.alerts)
    } catch (err: any) {
      console.error('Dashboard fetch error:', err)
    }
  }, [apiUrl])

  const fetchBookings = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filters.status !== 'all') params.set('status', filters.status)
      if (filters.date !== 'all') params.set('date', filters.date)
      if (filters.search.trim()) params.set('search', filters.search.trim())
      params.set('page', String(filters.page))
      params.set('limit', '25')

      const res = await fetch(`${apiUrl}/api/admin/bookings?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch bookings')
      const data = await res.json()
      setBookings(data.bookings || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
    } catch (err: any) {
      console.error('Bookings fetch error:', err)
      setError(err.message)
    }
  }, [apiUrl, filters])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([fetchDashboard(), fetchBookings()])
    setLoading(false)
  }, [fetchDashboard, fetchBookings])

  // Initial fetch + polling
  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [fetchAll])

  // Re-fetch on manual refresh
  useEffect(() => {
    if (refreshRef.current > 0) {
      fetchAll()
    }
  }, [refreshRef.current]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    refreshRef.current += 1
    fetchAll()
  }, [fetchAll])

  const setStatus = useCallback((s: StatusFilter) => {
    setFilters((prev) => ({ ...prev, status: s, page: 1 }))
  }, [])

  const setDate = useCallback((d: DateFilter) => {
    setFilters((prev) => ({ ...prev, date: d, page: 1 }))
  }, [])

  const setSearch = useCallback((s: string) => {
    setFilters((prev) => ({ ...prev, search: s, page: 1 }))
  }, [])

  const setPage = useCallback((p: number) => {
    setFilters((prev) => ({ ...prev, page: p }))
  }, [])

  return {
    stats,
    alerts,
    bookings,
    total,
    pages,
    currentPage: filters.page,
    filters,
    setStatus,
    setDate,
    setSearch,
    setPage,
    loading,
    error,
    refresh,
  }
}
