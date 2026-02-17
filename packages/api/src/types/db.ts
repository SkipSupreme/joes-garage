import type { PoolClient, Pool } from 'pg';

// ── Row types (match database columns) ─────────────────────────────────────

export interface CustomerRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  created_at: string;
}

export interface ReservationRow {
  id: string;
  booking_ref: string;
  customer_id: string | null;
  bike_id: number | null;
  rental_period: string; // tstzrange serialized as string
  duration_type: string;
  status: 'hold' | 'paid' | 'active' | 'completed' | 'cancelled';
  source: 'online' | 'walk-in' | null;
  hold_expires: string | null;
  total_amount: string; // numeric comes as string from pg
  deposit_amount: string;
  payment_token: string | null;
  moneris_txn: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReservationItemRow {
  id: string;
  reservation_id: string;
  bike_id: number;
  rental_period: string;
  rental_price: string;
  deposit_amount: string;
  checked_out_at: string | null;
  checked_in_at: string | null;
  created_at: string;
}

export interface WaiverRow {
  id: string;
  reservation_id: string | null;
  customer_id: string;
  pdf_storage_key: string;
  pdf_sha256: string;
  signed_at: string;
  signer_ip: string;
  signer_ua: string;
  consent_electronic: boolean;
  consent_terms: boolean;
  is_minor: boolean;
  guardian_customer_id: string | null;
  created_at: string;
}

export interface NoteRow {
  id: string;
  reservation_id: string;
  text: string;
  created_by: string;
  created_at: string;
}

// ── Joined / enriched types ────────────────────────────────────────────────

export interface ReservationWithCustomer extends ReservationRow {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_dob?: string | null;
}

export interface ReservationItemWithBike extends ReservationItemRow {
  bike_name: string;
  bike_type: string;
  bike_size?: string;
  return_time?: string;
}

export interface BikeRow {
  id: number;
  name: string;
  type: string;
  size: string;
  status: string;
  price2h: string;
  price4h: string;
  price8h: string;
  price_per_day: string;
  deposit_amount: string;
  photo_id: number | null;
}

// ── Service result ─────────────────────────────────────────────────────────

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(status: number, error: string): ServiceResult<T> {
  return { ok: false, status, error };
}

// ── Database client type ───────────────────────────────────────────────────

/** A pg Pool or PoolClient — both support .query() */
export type DbClient = Pool | PoolClient;
