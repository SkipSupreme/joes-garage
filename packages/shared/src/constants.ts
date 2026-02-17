/**
 * Shared constants for Joe's Garage booking system.
 * Used by both the frontend (Alpine.js) and API (Express).
 */

export const TIMEZONE = 'America/Edmonton';

// ── Duration types ───────────────────────────────────────────────────────

export type DurationType = '2h' | '4h' | '8h' | 'multi-day';

export const DURATION_TYPES = ['2h', '4h', '8h', 'multi-day'] as const;

/** Hours per duration type (multi-day is per-day, handled separately). */
export const DURATION_HOURS: Record<string, number> = {
  '2h': 2,
  '4h': 4,
  '8h': 8,
};

/** Human-readable labels for each duration type. String-indexable for DB lookups. */
export const DURATION_LABELS: Record<string, string> = {
  '2h': '2 Hours',
  '4h': '4 Hours',
  '8h': 'Full Day',
  'multi-day': 'Multi-Day',
};

/** Map duration type to the price column in the bikes table. String-indexable for DB lookups. */
export const PRICE_COLUMN: Record<string, string> = {
  '2h': 'price2h',
  '4h': 'price4h',
  '8h': 'price8h',
  'multi-day': 'price_per_day',
};

// ── Booking statuses ─────────────────────────────────────────────────────

export type BookingStatus = 'hold' | 'paid' | 'active' | 'completed' | 'cancelled';

export const BOOKING_STATUSES = ['hold', 'paid', 'active', 'completed', 'cancelled'] as const;

export type BookingSource = 'online' | 'walk-in';
