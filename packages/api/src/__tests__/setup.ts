import pool from '../db/pool.js';

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || 'dev-admin-secret-change-in-production';

/** Authorization header for admin endpoints */
export const adminAuth = `Bearer ${ADMIN_SECRET}`;

/** Clean up all test data from bookings schema (preserves table structure) */
export async function truncateBookings(): Promise<void> {
  await pool.query(`
    TRUNCATE bookings.notes, bookings.waivers, bookings.reservation_items, bookings.reservations, bookings.customers CASCADE
  `);
}

/** Insert a test customer and return their ID */
export async function insertTestCustomer(overrides?: Partial<{
  fullName: string;
  email: string;
  phone: string;
}>): Promise<string> {
  const result = await pool.query(
    `INSERT INTO bookings.customers (full_name, email, phone)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [
      overrides?.fullName ?? 'Test Customer',
      overrides?.email ?? `test-${Date.now()}@example.com`,
      overrides?.phone ?? '403-555-0100',
    ],
  );
  return result.rows[0].id;
}

/** Create a reservation directly in the DB for testing. Returns { id, booking_ref }. */
export async function insertTestReservation(overrides?: Partial<{
  customerId: string;
  bikeId: number;
  status: string;
  duration: string;
  source: string;
  totalAmount: number;
  depositAmount: number;
  holdExpires: string;
  startOffset: string; // e.g., 'NOW()' or "NOW() + INTERVAL '1 hour'"
  endOffset: string;
}>): Promise<{ id: string; booking_ref: string }> {
  const start = overrides?.startOffset ?? 'NOW()';
  const end = overrides?.endOffset ?? "NOW() + INTERVAL '2 hours'";

  const result = await pool.query(
    `INSERT INTO bookings.reservations
       (customer_id, bike_id, rental_period, duration_type, status, source, total_amount, deposit_amount, hold_expires)
     VALUES
       ($1, $2, tstzrange(${start}, ${end}, '[)'), $3, $4, $5, $6, $7, $8)
     RETURNING id, booking_ref`,
    [
      overrides?.customerId ?? null,
      overrides?.bikeId ?? null,
      overrides?.duration ?? '2h',
      overrides?.status ?? 'hold',
      overrides?.source ?? 'website',
      overrides?.totalAmount ?? 225,
      overrides?.depositAmount ?? 200,
      overrides?.holdExpires ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    ],
  );
  return result.rows[0];
}

/** Insert a reservation_item for a given reservation */
export async function insertTestItem(
  reservationId: string,
  bikeId: number,
  overrides?: Partial<{
    rentalPrice: number;
    depositAmount: number;
    checkedOutAt: string | null;
    checkedInAt: string | null;
    startOffset: string;
    endOffset: string;
  }>,
): Promise<string> {
  const start = overrides?.startOffset ?? 'NOW()';
  const end = overrides?.endOffset ?? "NOW() + INTERVAL '2 hours'";

  const result = await pool.query(
    `INSERT INTO bookings.reservation_items
       (reservation_id, bike_id, rental_period, rental_price, deposit_amount, checked_out_at, checked_in_at)
     VALUES
       ($1, $2, tstzrange(${start}, ${end}, '[)'), $3, $4, $5, $6)
     RETURNING id`,
    [
      reservationId,
      bikeId,
      overrides?.rentalPrice ?? 25,
      overrides?.depositAmount ?? 200,
      overrides?.checkedOutAt ?? null,
      overrides?.checkedInAt ?? null,
    ],
  );
  return result.rows[0].id;
}

/** Shut down the pool (call in afterAll) */
export async function closePool(): Promise<void> {
  await pool.end();
}
