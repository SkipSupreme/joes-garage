/**
 * Shared TypeScript interfaces for API request/response contracts.
 * These types define what the API accepts and returns, used by both
 * the frontend (for type-safe fetch calls) and the API (for handlers).
 */

import type { BookingStatus, BookingSource, DurationType } from './constants.js';

// ── Availability ─────────────────────────────────────────────────────────

export interface AvailabilityQuery {
  date: string;       // YYYY-MM-DD
  duration: DurationType;
  startTime?: string; // HH:MM (for 2h/4h)
  endDate?: string;   // YYYY-MM-DD (for multi-day)
}

export interface AvailableBike {
  id: number;
  name: string;
  type: string;
  size: string;
  available_count: number;
  price2h: string;
  price4h: string;
  price8h: string;
  price_per_day: string;
  deposit_amount: string;
  photo_url: string | null;
  photo_alt: string | null;
}

export interface AvailabilityResponse {
  bikes: AvailableBike[];
  date: string;
  duration: DurationType;
}

// ── Booking ──────────────────────────────────────────────────────────────

export interface BookingSummary {
  id: string;
  booking_ref: string;
  status: BookingStatus;
  source: BookingSource | null;
  duration_type: DurationType;
  customer_name: string | null;
  customer_email: string | null;
  total_amount: string;
  created_at: string;
}

export interface BookingDetail extends BookingSummary {
  customer_phone: string | null;
  deposit_amount: string;
  hold_expires: string | null;
  items: BookingItem[];
  notes: BookingNote[];
  waivers: BookingWaiver[];
}

export interface BookingItem {
  id: string;
  bike_id: number;
  bike_name: string;
  bike_type: string;
  rental_price: string;
  deposit_amount: string;
  checked_out_at: string | null;
  checked_in_at: string | null;
}

export interface BookingNote {
  id: string;
  text: string;
  created_by: string;
  created_at: string;
}

export interface BookingWaiver {
  id: string;
  full_name: string;
  email: string;
  signed_at: string;
}

// ── Hold creation ────────────────────────────────────────────────────────

export interface CreateHoldRequest {
  date: string;
  duration: DurationType;
  startTime?: string;
  endDate?: string;
  bikes: Array<{ bikeId: number; quantity: number }>;
  customer: {
    fullName: string;
    email: string;
    phone: string;
  };
}

export interface CreateHoldResponse {
  reservationId: string;
  bookingRef: string;
  holdExpires: string;
  totalAmount: string;
  depositAmount: string;
  hmac: string;
}

// ── Waiver ───────────────────────────────────────────────────────────────

export interface SubmitWaiverRequest {
  reservationId?: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  isMinor: boolean;
  guardianName?: string;
  signatureDataUrl: string;
  consentElectronic: boolean;
  consentTerms: boolean;
}

// ── Dashboard ────────────────────────────────────────────────────────────

export interface DashboardKPIs {
  todayBookings: number;
  activeRentals: number;
  bikesOut: number;
  totalBikes: number;
  todayRevenue: string;
}

export interface FleetBike {
  id: number;
  name: string;
  type: string;
  status: string;
  currentRental: string | null;
}
