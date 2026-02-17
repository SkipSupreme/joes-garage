import pool from '../db/pool.js';
import { TIMEZONE, DURATION_HOURS, PRICE_COLUMN } from '../constants.js';
import { buildRangeBounds } from './time-range.js';
import type { ServiceResult } from '../types/db.js';
import { ok, fail } from '../types/db.js';

// ── Fleet status ───────────────────────────────────────────────────────────

export interface FleetGroup {
  type: string;
  total: number;
  available: number;
  rented_out: number;
  reserved: number;
  maintenance: number;
}

export async function getFleetStatus(): Promise<ServiceResult<{ fleet: FleetGroup[] }>> {
  try {
    const result = await pool.query(`
      SELECT
        b.type,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE b.status = 'available'
            AND NOT EXISTS (
              SELECT 1 FROM bookings.reservation_items ri
              JOIN bookings.reservations r ON r.id = ri.reservation_id
              WHERE ri.bike_id = b.id
                AND r.status = 'active'
                AND ri.checked_out_at IS NOT NULL
                AND ri.checked_in_at IS NULL
            )
        )::int AS available,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM bookings.reservation_items ri
            JOIN bookings.reservations r ON r.id = ri.reservation_id
            WHERE ri.bike_id = b.id
              AND r.status = 'active'
              AND ri.checked_out_at IS NOT NULL
              AND ri.checked_in_at IS NULL
          )
        )::int AS rented_out,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM bookings.reservation_items ri
            JOIN bookings.reservations r ON r.id = ri.reservation_id
            WHERE ri.bike_id = b.id
              AND r.status = 'paid'
              AND ri.checked_out_at IS NULL
              AND ri.rental_period && tstzrange(NOW(), NULL, '[)')
          )
        )::int AS reserved,
        COUNT(*) FILTER (WHERE b.status = 'in-repair')::int AS maintenance
      FROM bikes b
      GROUP BY b.type
      ORDER BY b.type
    `);

    return ok({ fleet: result.rows });
  } catch (err) {
    console.error('Fleet status error:', err);
    return fail(500, 'Failed to load fleet status');
  }
}

// ── Availability check ─────────────────────────────────────────────────────

export interface AvailableBikeGroup {
  id: number;
  name: string;
  type: string;
  size: string;
  bike_ids: number[];
  available_count: number;
  rental_price: string;
  price2h: string;
  price4h: string;
  price8h: string;
  price_per_day: string;
  deposit_amount: string;
  photo_url: string | null;
  photo_alt: string | null;
}

const CMS_URL = process.env.CMS_URL || 'http://localhost:3003';

export async function checkAvailability(
  date: string,
  duration: string,
  startTime?: string,
  endDate?: string,
): Promise<ServiceResult<{ bikes: AvailableBikeGroup[] }>> {
  const { rangeStart, rangeEnd } = buildRangeBounds(date, duration, startTime, endDate);
  const priceCol = PRICE_COLUMN[duration];

  try {
    const result = await pool.query(
      `
      WITH available AS (
        SELECT b.id, b.name, b.type, b.size,
               b.price2h, b.price4h, b.price8h, b.price_per_day,
               b.deposit_amount,
               CASE $4
                 WHEN '2h' THEN b.price2h
                 WHEN '4h' THEN b.price4h
                 WHEN '8h' THEN b.price8h
                 WHEN 'multi-day' THEN b.price_per_day
               END AS rental_price,
               m.url AS photo_url, m.alt AS photo_alt
        FROM bikes b
        LEFT JOIN media m ON m.id = b.photo_id
        WHERE b.status = 'available'
          AND NOT EXISTS (
            SELECT 1
            FROM bookings.reservation_items ri
            JOIN bookings.reservations r ON r.id = ri.reservation_id
            WHERE ri.bike_id = b.id
              AND ri.rental_period && tstzrange(
                ($1::timestamp AT TIME ZONE $3),
                ($2::timestamp AT TIME ZONE $3),
                '[)'
              )
              AND r.status NOT IN ('cancelled')
          )
      )
      SELECT name, type, size,
             (array_agg(id ORDER BY id))[1] AS id,
             json_agg(id ORDER BY id) AS bike_ids,
             count(*)::int AS available_count,
             min(rental_price) AS rental_price,
             min(price2h) AS price2h,
             min(price4h) AS price4h,
             min(price8h) AS price8h,
             min(price_per_day) AS price_per_day,
             min(deposit_amount) AS deposit_amount,
             (array_agg(photo_url))[1] AS photo_url,
             (array_agg(photo_alt))[1] AS photo_alt
      FROM available
      GROUP BY name, type, size
      ORDER BY type, name, size
      `,
      [rangeStart, rangeEnd, TIMEZONE, duration],
    );

    const bikes = result.rows.map((row: AvailableBikeGroup) => ({
      ...row,
      photo_url: row.photo_url ? `${CMS_URL}${row.photo_url}` : null,
    }));

    return ok({ bikes });
  } catch (err) {
    console.error('Availability query error:', err);
    return fail(500, 'Failed to check availability');
  }
}
