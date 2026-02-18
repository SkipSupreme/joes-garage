import pool from '../db/pool.js';
import { TIMEZONE, DURATION_HOURS } from '../constants.js';
import { buildRangeBounds } from './time-range.js';
import { upsertCustomer } from './customer.service.js';
import { preloadCheckout, getReceipt, capture, voidTransaction } from './moneris.js';
import { sendBookingConfirmation, sendAdminNotification } from './email.js';
import { generateBookingToken } from '../routes/bookings.js';
import { logger } from '../lib/logger.js';
import type { ServiceResult, ReservationWithCustomer, ReservationItemWithBike, NoteRow } from '../types/db.js';
import { ok, fail } from '../types/db.js';
import crypto from 'crypto';

/** Round to 2 decimal places to prevent floating-point accumulation errors in pricing. */
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface DashboardData {
  stats: {
    active_rentals: number;
    returns_due_today: number;
    overdue_count: number;
    available_fleet: number;
    total_fleet: number;
    waivers_ready: number;
  };
  alerts: {
    overdue: Array<{
      reservation_id: string;
      customer_name: string;
      bike_name: string;
      due_at: string;
    }>;
    unsigned_waivers: Array<{
      reservation_id: string;
      customer_name: string;
      item_count: number;
      waiver_count: number;
    }>;
  };
}

export async function getDashboard(): Promise<ServiceResult<DashboardData>> {
  try {
    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM bookings.reservation_items ri
         JOIN bookings.reservations r ON r.id = ri.reservation_id
         WHERE r.status = 'active' AND ri.checked_out_at IS NOT NULL AND ri.checked_in_at IS NULL
        )::int AS active_rentals,
        (SELECT COUNT(*) FROM bookings.reservation_items ri
         JOIN bookings.reservations r ON r.id = ri.reservation_id
         WHERE r.status = 'active'
           AND ri.checked_out_at IS NOT NULL
           AND ri.checked_in_at IS NULL
           AND upper(ri.rental_period) >= DATE_TRUNC('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1
           AND upper(ri.rental_period) < (DATE_TRUNC('day', NOW() AT TIME ZONE $1) + INTERVAL '1 day') AT TIME ZONE $1
        )::int AS returns_due_today,
        (SELECT COUNT(*) FROM bookings.reservation_items ri
         JOIN bookings.reservations r ON r.id = ri.reservation_id
         WHERE r.status = 'active'
           AND ri.checked_out_at IS NOT NULL
           AND ri.checked_in_at IS NULL
           AND upper(ri.rental_period) < NOW()
        )::int AS overdue_count,
        (SELECT COUNT(*) FROM bikes WHERE status = 'available')::int AS available_fleet,
        (SELECT COUNT(*) FROM bikes)::int AS total_fleet
    `, [TIMEZONE]);

    const stats = statsResult.rows[0];

    const overdueResult = await pool.query(`
      SELECT
        r.id AS reservation_id,
        c.full_name AS customer_name,
        b.name AS bike_name,
        upper(ri.rental_period) AS due_at
      FROM bookings.reservation_items ri
      JOIN bookings.reservations r ON r.id = ri.reservation_id
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      LEFT JOIN bikes b ON b.id = ri.bike_id
      WHERE r.status = 'active'
        AND ri.checked_out_at IS NOT NULL
        AND ri.checked_in_at IS NULL
        AND upper(ri.rental_period) < NOW()
      ORDER BY upper(ri.rental_period) ASC
    `);

    const unsignedResult = await pool.query(`
      SELECT
        r.id AS reservation_id,
        c.full_name AS customer_name,
        COUNT(DISTINCT ri.id)::int AS item_count,
        COUNT(DISTINCT w.id)::int AS waiver_count
      FROM bookings.reservations r
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      LEFT JOIN bookings.reservation_items ri ON ri.reservation_id = r.id
      LEFT JOIN bookings.waivers w ON w.reservation_id = r.id
      WHERE r.status IN ('hold', 'paid')
        AND lower(r.rental_period) >= NOW()
        AND lower(r.rental_period) <= NOW() + INTERVAL '24 hours'
      GROUP BY r.id, c.full_name
      HAVING COUNT(DISTINCT w.id) < COUNT(DISTINCT ri.id)
    `);

    const unlinkedResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM bookings.waivers
      WHERE reservation_id IS NULL
        AND signed_at::date = CURRENT_DATE
    `);

    return ok({
      stats: { ...stats, waivers_ready: unlinkedResult.rows[0].count },
      alerts: {
        overdue: overdueResult.rows,
        unsigned_waivers: unsignedResult.rows,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Dashboard error');
    return fail(500, 'Failed to load dashboard');
  }
}

// ── List bookings ──────────────────────────────────────────────────────────

export interface BookingsListFilters {
  status: string;
  date: string;
  search?: string;
  page: number;
  limit: number;
}

export interface BookingsListResult {
  bookings: any[];
  total: number;
  page: number;
  pages: number;
}

export async function listBookings(filters: BookingsListFilters): Promise<ServiceResult<BookingsListResult>> {
  const { status, date, search, page, limit } = filters;
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (status === 'overdue') {
    conditions.push(`r.status = 'active'`);
    conditions.push(`EXISTS (
      SELECT 1 FROM bookings.reservation_items ri
      WHERE ri.reservation_id = r.id
        AND ri.checked_out_at IS NOT NULL
        AND ri.checked_in_at IS NULL
        AND upper(ri.rental_period) < NOW()
    )`);
  } else if (status !== 'all') {
    conditions.push(`r.status = $${paramIdx}`);
    params.push(status);
    paramIdx++;
  }

  if (date === 'today') {
    conditions.push(`lower(r.rental_period) >= DATE_TRUNC('day', NOW() AT TIME ZONE $${paramIdx}) AT TIME ZONE $${paramIdx}`);
    conditions.push(`lower(r.rental_period) < (DATE_TRUNC('day', NOW() AT TIME ZONE $${paramIdx}) + INTERVAL '1 day') AT TIME ZONE $${paramIdx}`);
    params.push(TIMEZONE);
    paramIdx++;
  } else if (date === 'upcoming') {
    conditions.push(`lower(r.rental_period) > NOW()`);
  } else if (date === 'past') {
    conditions.push(`upper(r.rental_period) < NOW()`);
  }

  if (search && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    conditions.push(`(c.full_name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx} OR c.phone ILIKE $${paramIdx} OR r.booking_ref ILIKE $${paramIdx} OR r.id::text ILIKE $${paramIdx})`);
    params.push(searchTerm);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM bookings.reservations r
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       ${whereClause}`,
      params,
    );
    const total = countResult.rows[0].total;
    const pages = Math.ceil(total / limit) || 1;

    const bookingsResult = await pool.query(
      `SELECT
        r.id, r.booking_ref, r.customer_id, r.rental_period, r.duration_type, r.status, r.source,
        r.hold_expires, r.total_amount, r.deposit_amount, r.created_at, r.updated_at,
        c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
        (SELECT COUNT(*)::int FROM bookings.reservation_items ri WHERE ri.reservation_id = r.id) AS item_count,
        (SELECT COUNT(*)::int FROM bookings.waivers w WHERE w.reservation_id = r.id) AS waiver_count,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', ri.id, 'bike_id', ri.bike_id, 'rental_period', ri.rental_period,
          'rental_price', ri.rental_price, 'deposit_amount', ri.deposit_amount,
          'checked_out_at', ri.checked_out_at, 'checked_in_at', ri.checked_in_at,
          'bike_name', b.name, 'bike_type', b.type
        ) ORDER BY ri.created_at), '[]'::json)
        FROM bookings.reservation_items ri
        LEFT JOIN bikes b ON b.id = ri.bike_id
        WHERE ri.reservation_id = r.id
        ) AS items,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', w.id, 'signed_at', w.signed_at, 'is_minor', w.is_minor
        ) ORDER BY w.created_at), '[]'::json)
        FROM bookings.waivers w
        WHERE w.reservation_id = r.id
        ) AS waivers,
        EXISTS (
          SELECT 1 FROM bookings.reservation_items ri
          WHERE ri.reservation_id = r.id
            AND ri.checked_out_at IS NOT NULL AND ri.checked_in_at IS NULL
            AND upper(ri.rental_period) < NOW()
        ) AS is_overdue
      FROM bookings.reservations r
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      ${whereClause}
      ORDER BY is_overdue DESC, r.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return ok({ bookings: bookingsResult.rows, total, page, pages });
  } catch (err) {
    logger.error({ err }, 'Bookings list error');
    return fail(500, 'Failed to list bookings');
  }
}

// ── Booking detail ─────────────────────────────────────────────────────────

export interface BookingDetail extends ReservationWithCustomer {
  items: ReservationItemWithBike[];
  waivers: any[];
  notes: NoteRow[];
  is_overdue: boolean;
}

export async function getBookingDetail(id: string): Promise<ServiceResult<BookingDetail>> {
  try {
    const resResult = await pool.query(
      `SELECT
        r.id, r.booking_ref, r.customer_id, r.bike_id, r.rental_period, r.duration_type, r.status, r.source,
        r.hold_expires, r.total_amount, r.deposit_amount,
        r.created_at, r.updated_at,
        c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
        c.date_of_birth AS customer_dob
      FROM bookings.reservations r
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      WHERE r.id = $1`,
      [id],
    );

    if (resResult.rowCount === 0) {
      return fail(404, 'Booking not found');
    }

    const reservation = resResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT
        ri.id, ri.bike_id, ri.rental_period, ri.rental_price, ri.deposit_amount,
        ri.checked_out_at, ri.checked_in_at, ri.created_at,
        upper(ri.rental_period) AS return_time,
        b.name AS bike_name, b.type AS bike_type, b.size AS bike_size
      FROM bookings.reservation_items ri
      LEFT JOIN bikes b ON b.id = ri.bike_id
      WHERE ri.reservation_id = $1
      ORDER BY ri.created_at`,
      [id],
    );

    const waiversResult = await pool.query(
      `SELECT
        w.id, w.signed_at, w.is_minor, w.consent_electronic, w.consent_terms, w.created_at,
        c.full_name AS signer_name, c.email AS signer_email,
        gc.full_name AS guardian_name
      FROM bookings.waivers w
      LEFT JOIN bookings.customers c ON w.customer_id = c.id
      LEFT JOIN bookings.customers gc ON w.guardian_customer_id = gc.id
      WHERE w.reservation_id = $1
      ORDER BY w.created_at`,
      [id],
    );

    const notesResult = await pool.query(
      `SELECT id, text, created_by, created_at
      FROM bookings.notes
      WHERE reservation_id = $1
      ORDER BY created_at DESC`,
      [id],
    );

    const is_overdue = itemsResult.rows.some(
      (item: any) =>
        item.checked_out_at &&
        !item.checked_in_at &&
        item.return_time &&
        new Date(item.return_time) < new Date(),
    );

    return ok({
      ...reservation,
      items: itemsResult.rows,
      waivers: waiversResult.rows,
      notes: notesResult.rows,
      is_overdue,
    });
  } catch (err) {
    logger.error({ err }, 'Booking detail error');
    return fail(500, 'Failed to fetch booking');
  }
}

// ── Public booking lookup ──────────────────────────────────────────────────

export async function getPublicBooking(param: string, isUuid: boolean): Promise<ServiceResult<any>> {
  try {
    const whereClause = isUuid
      ? 'r.id = $1'
      : 'UPPER(r.booking_ref) = UPPER($1)';

    const result = await pool.query(
      `SELECT r.id, r.booking_ref, r.bike_id, r.rental_period, r.duration_type, r.status,
             r.total_amount, r.deposit_amount,
             (r.total_amount - r.deposit_amount) AS rental_amount,
             r.created_at, c.full_name, c.email,
             b.name AS bike_name, b.type AS bike_type
      FROM bookings.reservations r
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      LEFT JOIN bikes b ON b.id = r.bike_id
      WHERE ${whereClause} AND r.status IN ('hold', 'paid', 'active', 'completed')`,
      [param],
    );

    if (result.rowCount === 0) {
      return fail(404, 'Booking not found');
    }

    const bookingId = result.rows[0].id;

    const itemsResult = await pool.query(
      `SELECT ri.bike_id, ri.rental_price, ri.deposit_amount,
              b.name AS bike_name, b.type AS bike_type
       FROM bookings.reservation_items ri
       JOIN bikes b ON b.id = ri.bike_id
       WHERE ri.reservation_id = $1
       ORDER BY ri.created_at`,
      [bookingId],
    );

    const waiversResult = await pool.query(
      `SELECT w.id, w.signed_at, w.is_minor, c.full_name, c.email
       FROM bookings.waivers w
       JOIN bookings.customers c ON w.customer_id = c.id
       WHERE w.reservation_id = $1
       ORDER BY w.created_at`,
      [bookingId],
    );

    const booking = result.rows[0];
    booking.items = itemsResult.rows;
    booking.item_count = itemsResult.rows.length || 1;
    booking.waivers = waiversResult.rows;

    return ok(booking);
  } catch (err) {
    logger.error({ err }, 'Booking fetch error');
    return fail(500, 'Failed to fetch booking');
  }
}

// ── Create hold ────────────────────────────────────────────────────────────

export interface HoldInput {
  bikes: Array<{ bikeId: number }>;
  date: string;
  duration: string;
  startTime?: string;
  endDate?: string;
}

export interface HoldResult {
  reservationId: string;
  bookingRef: string;
  bookingToken: string;
  holdExpiresAt: string;
}

export async function createHold(data: HoldInput): Promise<ServiceResult<HoldResult>> {
  const { bikes, date, duration, startTime, endDate } = data;
  const bikeIds = bikes.map((b) => b.bikeId);
  const { rangeStart, rangeEnd } = buildRangeBounds(date, duration, startTime, endDate);

  if (new Set(bikeIds).size !== bikeIds.length) {
    return fail(400, 'Duplicate bike IDs in request');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Self-heal: cancelled bookings should not keep blocking the same time slot.
    // Release overlapping cancelled item ranges before availability enforcement.
    await client.query(
      `UPDATE bookings.reservation_items ri
       SET rental_period = 'empty'::tstzrange
       FROM bookings.reservations r
       WHERE r.id = ri.reservation_id
         AND r.status = 'cancelled'
         AND ri.bike_id = ANY($1)
         AND NOT isempty(ri.rental_period)
         AND ri.rental_period && tstzrange(
           ($2::timestamp AT TIME ZONE $4),
           ($3::timestamp AT TIME ZONE $4),
           '[)'
         )`,
      [bikeIds, rangeStart, rangeEnd, TIMEZONE],
    );

    const bikeCheck = await client.query(
      `SELECT id,
        CASE $2
          WHEN '2h' THEN price2h
          WHEN '4h' THEN price4h
          WHEN '8h' THEN price8h
          WHEN 'multi-day' THEN price_per_day
        END AS rental_price,
        price8h, price_per_day, deposit_amount
       FROM bikes WHERE id = ANY($1) AND status = 'available'`,
      [bikeIds, duration],
    );

    if (bikeCheck.rowCount !== bikeIds.length) {
      const foundIds = new Set(bikeCheck.rows.map((b: any) => b.id));
      const missing = bikeIds.filter((id) => !foundIds.has(id));
      await client.query('ROLLBACK');
      return fail(404, `Bike(s) not found or not available: ${missing.join(', ')}`);
    }

    const bikeMap = new Map(bikeCheck.rows.map((b: any) => [b.id, b]));
    let totalRentalCost = 0;
    let totalDeposit = 0;

    interface BikeItem {
      bikeId: number;
      rentalPrice: number;
      depositAmount: number;
    }
    const itemDetails: BikeItem[] = [];

    for (const bikeId of bikeIds) {
      const bike = bikeMap.get(bikeId)!;
      let rentalCost: number;
      if (duration === 'multi-day') {
        const start = new Date(date);
        const end = new Date(endDate!);
        const rentalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const firstDay = parseFloat(bike.price8h);
        const additionalRate = parseFloat(bike.price_per_day);
        rentalCost = roundCents(firstDay + additionalRate * Math.max(0, rentalDays - 1));
      } else {
        rentalCost = parseFloat(bike.rental_price);
      }
      const deposit = parseFloat(bike.deposit_amount);
      totalRentalCost = roundCents(totalRentalCost + rentalCost);
      totalDeposit = roundCents(totalDeposit + deposit);
      itemDetails.push({ bikeId, rentalPrice: rentalCost, depositAmount: deposit });
    }

    const totalAmount = totalRentalCost + totalDeposit;

    const result = await client.query(
      `INSERT INTO bookings.reservations (bike_id, rental_period, duration_type, status, hold_expires, total_amount, deposit_amount)
      VALUES (
        $1,
        tstzrange($2::timestamp AT TIME ZONE $6, $3::timestamp AT TIME ZONE $6, '[)'),
        $4,
        'hold',
        NOW() + INTERVAL '15 minutes',
        $5,
        $7
      )
      RETURNING id, booking_ref, hold_expires`,
      [bikeIds[0], rangeStart, rangeEnd, duration, totalAmount, TIMEZONE, totalDeposit],
    );

    const reservation = result.rows[0];
    const reservationId = reservation.id;

    for (const item of itemDetails) {
      await client.query(
        `INSERT INTO bookings.reservation_items (reservation_id, bike_id, rental_period, rental_price, deposit_amount)
        VALUES (
          $1,
          $2,
          tstzrange($3::timestamp AT TIME ZONE $6, $4::timestamp AT TIME ZONE $6, '[)'),
          $5,
          $7
        )`,
        [reservationId, item.bikeId, rangeStart, rangeEnd, item.rentalPrice, TIMEZONE, item.depositAmount],
      );
    }

    await client.query('COMMIT');

    return ok({
      reservationId,
      bookingRef: reservation.booking_ref,
      bookingToken: generateBookingToken(reservation.booking_ref),
      holdExpiresAt: reservation.hold_expires,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23P01') {
      return fail(409, 'One or more bikes are no longer available for the selected time');
    }
    logger.error({ err }, 'Hold creation error');
    return fail(500, 'Failed to create hold');
  } finally {
    client.release();
  }
}

// ── Preload Moneris Checkout ───────────────────────────────────────────────

export async function preloadPayment(
  reservationId: string,
): Promise<ServiceResult<{ ticket: string; isSandbox: boolean }>> {
  const res = await pool.query(
    `SELECT r.id, r.status, r.total_amount, r.deposit_amount, r.booking_ref,
            c.email AS customer_email
     FROM bookings.reservations r
     LEFT JOIN bookings.customers c ON c.id = r.customer_id
     WHERE r.id = $1 AND r.status IN ('hold', 'paid')`,
    [reservationId],
  );

  if (res.rowCount === 0) {
    return fail(404, 'Reservation not found or expired');
  }

  const reservation = res.rows[0];
  const amount = parseFloat(reservation.deposit_amount || reservation.total_amount);
  const orderId = reservation.booking_ref || reservationId.slice(0, 8);

  const result = await preloadCheckout(amount, orderId, reservation.customer_email);

  if (!result.success) {
    return fail(502, result.error || 'Payment gateway error');
  }

  return ok({ ticket: result.ticket!, isSandbox: result.isSandbox });
}

// ── Process payment ────────────────────────────────────────────────────────

export interface PaymentResult {
  bookingId: string;
  confirmationNumber: string;
  bookingRef: string;
  bookingToken: string;
  status: string;
}

export async function processPayment(
  reservationId: string,
  monerisToken: string,
): Promise<ServiceResult<PaymentResult>> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const holdCheck = await client.query(
      `SELECT r.*, c.full_name AS customer_name, c.email AS customer_email
       FROM bookings.reservations r
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       WHERE r.id = $1 AND r.status = 'hold' AND r.hold_expires > NOW()
       FOR UPDATE OF r`,
      [reservationId],
    );

    if (holdCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(404, 'Reservation not found or hold expired');
    }

    const reservation = holdCheck.rows[0];

    const waiverCheck = await client.query(
      `SELECT w.id, w.pdf_storage_key FROM bookings.waivers w WHERE w.reservation_id = $1 LIMIT 1`,
      [reservationId],
    );
    if (waiverCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(400, 'Waiver must be signed before payment');
    }
    const firstWaiver = waiverCheck.rows[0];

    const monerisResult = await getReceipt(monerisToken);

    if (!monerisResult.success) {
      await client.query('ROLLBACK');
      return fail(402, monerisResult.message || 'Payment declined');
    }

    await client.query(
      `UPDATE bookings.reservations
      SET status = 'paid', payment_token = $2, moneris_txn = $3, updated_at = NOW()
      WHERE id = $1`,
      [reservationId, monerisToken, monerisResult.transactionId],
    );

    await client.query('COMMIT');

    const confirmationNumber = reservationId.split('-')[0].toUpperCase();

    const bookingRefResult = await pool.query(
      `SELECT booking_ref FROM bookings.reservations WHERE id = $1`,
      [reservationId],
    );
    const bookingRef = bookingRefResult.rows[0]?.booking_ref || '';

    // Fire-and-forget email sending (non-blocking)
    const rentalPeriod = reservation.rental_period;
    const periodMatch = rentalPeriod?.match(/[\[(]([\d\s:.+-]+),([\d\s:.+-]+)[)\]]/);
    const startTimestamp = periodMatch?.[1]?.trim() || '';
    const endTimestamp = periodMatch?.[2]?.trim() || '';

    const itemsResult = await pool.query(
      `SELECT ri.rental_price, ri.deposit_amount, b.name AS bike_name, b.type AS bike_type
       FROM bookings.reservation_items ri
       JOIN bikes b ON b.id = ri.bike_id
       WHERE ri.reservation_id = $1
       ORDER BY ri.created_at`,
      [reservationId],
    );

    const items = itemsResult.rows.map((row: any) => ({
      bikeName: row.bike_name,
      bikeType: row.bike_type,
      rentalPrice: parseFloat(row.rental_price).toFixed(2),
      depositAmount: parseFloat(row.deposit_amount).toFixed(2),
    }));

    let legacyBikeName: string | undefined;
    let legacyBikeType: string | undefined;
    if (items.length === 0 && reservation.bike_id) {
      const legacyBike = await pool.query(
        `SELECT name, type FROM bikes WHERE id = $1`,
        [reservation.bike_id],
      );
      if (legacyBike.rowCount && legacyBike.rowCount > 0) {
        legacyBikeName = legacyBike.rows[0].name;
        legacyBikeType = legacyBike.rows[0].type;
      }
    }

    const emailDetails = {
      bookingId: reservationId,
      confirmationNumber,
      customerName: reservation.customer_name || 'Customer',
      customerEmail: reservation.customer_email || '',
      items: items.length > 0 ? items : undefined,
      bikeName: legacyBikeName || (items.length === 1 ? items[0].bikeName : undefined),
      bikeType: legacyBikeType || (items.length === 1 ? items[0].bikeType : undefined),
      startDate: startTimestamp,
      endDate: endTimestamp,
      durationType: reservation.duration_type || 'multi-day',
      totalAmount: parseFloat(reservation.total_amount).toFixed(2),
      depositAmount: parseFloat(reservation.deposit_amount).toFixed(2),
      waiverStorageKey: firstWaiver.pdf_storage_key || undefined,
    };

    if (emailDetails.customerEmail) {
      sendBookingConfirmation(emailDetails).catch((err) =>
        logger.error({ err }, 'Failed to send confirmation email'),
      );
    }
    sendAdminNotification(emailDetails).catch((err) =>
      logger.error({ err }, 'Failed to send admin notification'),
    );

    return ok({
      bookingId: reservationId,
      confirmationNumber,
      bookingRef,
      bookingToken: generateBookingToken(bookingRef),
      status: 'paid',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Payment processing error');
    return fail(500, 'Failed to process payment');
  } finally {
    client.release();
  }
}

// ── Check out ──────────────────────────────────────────────────────────────

export interface CheckOutResult {
  status: string;
  checked_out: number;
}

export async function checkOut(
  reservationId: string,
  itemIds?: string[],
): Promise<ServiceResult<CheckOutResult>> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resCheck = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(404, 'Booking not found');
    }

    const { status } = resCheck.rows[0];
    if (status !== 'paid' && status !== 'active') {
      await client.query('ROLLBACK');
      return fail(400, `Cannot check out from '${status}' status. Booking must be 'paid' or 'active'.`);
    }

    if (itemIds && itemIds.length > 0) {
      await client.query(
        `SELECT id FROM bookings.reservation_items WHERE reservation_id = $1 AND id = ANY($2) FOR UPDATE`,
        [reservationId, itemIds],
      );
    } else {
      await client.query(
        `SELECT id FROM bookings.reservation_items WHERE reservation_id = $1 AND checked_out_at IS NULL FOR UPDATE`,
        [reservationId],
      );
    }

    let updateResult;
    if (itemIds && itemIds.length > 0) {
      updateResult = await client.query(
        `UPDATE bookings.reservation_items
         SET checked_out_at = NOW()
         WHERE reservation_id = $1
           AND id = ANY($2)
           AND checked_out_at IS NULL
         RETURNING id`,
        [reservationId, itemIds],
      );
    } else {
      updateResult = await client.query(
        `UPDATE bookings.reservation_items
         SET checked_out_at = NOW()
         WHERE reservation_id = $1
           AND checked_out_at IS NULL
         RETURNING id`,
        [reservationId],
      );
    }

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(400, 'No items to check out (already checked out or invalid IDs)');
    }

    await client.query(
      `UPDATE bookings.reservations SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [reservationId],
    );

    await client.query('COMMIT');

    return ok({ status: 'active', checked_out: updateResult.rowCount! });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Check-out error');
    return fail(500, 'Failed to check out');
  } finally {
    client.release();
  }
}

// ── Check in ───────────────────────────────────────────────────────────────

export interface CheckInResult {
  status: string;
  checked_in: number;
  all_returned: boolean;
}

export async function checkIn(
  reservationId: string,
  itemIds?: string[],
  notes?: string,
): Promise<ServiceResult<CheckInResult>> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resCheck = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(404, 'Booking not found');
    }

    if (resCheck.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return fail(400, `Cannot check in from '${resCheck.rows[0].status}' status. Booking must be 'active'.`);
    }

    if (itemIds && itemIds.length > 0) {
      await client.query(
        `SELECT id FROM bookings.reservation_items WHERE reservation_id = $1 AND id = ANY($2) FOR UPDATE`,
        [reservationId, itemIds],
      );
    } else {
      await client.query(
        `SELECT id FROM bookings.reservation_items WHERE reservation_id = $1 AND checked_out_at IS NOT NULL AND checked_in_at IS NULL FOR UPDATE`,
        [reservationId],
      );
    }

    let updateResult;
    if (itemIds && itemIds.length > 0) {
      updateResult = await client.query(
        `UPDATE bookings.reservation_items
         SET checked_in_at = NOW()
         WHERE reservation_id = $1
           AND id = ANY($2)
           AND checked_out_at IS NOT NULL
           AND checked_in_at IS NULL
         RETURNING id`,
        [reservationId, itemIds],
      );
    } else {
      updateResult = await client.query(
        `UPDATE bookings.reservation_items
         SET checked_in_at = NOW()
         WHERE reservation_id = $1
           AND checked_out_at IS NOT NULL
           AND checked_in_at IS NULL
         RETURNING id`,
        [reservationId],
      );
    }

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(400, 'No items to check in (not checked out or already returned)');
    }

    if (notes) {
      await client.query(
        `INSERT INTO bookings.notes (reservation_id, text, created_by) VALUES ($1, $2, 'admin')`,
        [reservationId, notes],
      );
    }

    const remainingResult = await client.query(
      `SELECT COUNT(*)::int AS remaining
       FROM bookings.reservation_items
       WHERE reservation_id = $1
         AND checked_out_at IS NOT NULL
         AND checked_in_at IS NULL`,
      [reservationId],
    );

    const allReturned = remainingResult.rows[0].remaining === 0;
    let newStatus = 'active';

    if (allReturned) {
      await client.query(
        `UPDATE bookings.reservations SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [reservationId],
      );
      newStatus = 'completed';
    }

    await client.query('COMMIT');

    return ok({ status: newStatus, checked_in: updateResult.rowCount!, all_returned: allReturned });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Check-in error');
    return fail(500, 'Failed to check in');
  } finally {
    client.release();
  }
}

// ── Cancel booking ─────────────────────────────────────────────────────────

export async function cancelBooking(
  reservationId: string,
  reason?: string,
): Promise<ServiceResult<{ status: string }>> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resCheck = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(404, 'Booking not found');
    }
    if (!['hold', 'paid'].includes(resCheck.rows[0].status)) {
      await client.query('ROLLBACK');
      return fail(400, 'Booking cannot be cancelled from current status (must be hold or paid)');
    }

    await client.query(
      `UPDATE bookings.reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [reservationId],
    );
    await client.query(
      `UPDATE bookings.reservation_items
       SET rental_period = 'empty'::tstzrange
       WHERE reservation_id = $1
         AND NOT isempty(rental_period)`,
      [reservationId],
    );

    if (reason) {
      await client.query(
        `INSERT INTO bookings.notes (reservation_id, text, created_by) VALUES ($1, $2, 'admin')`,
        [reservationId, `Cancelled: ${reason}`],
      );
    }

    await client.query('COMMIT');
    return ok({ status: 'cancelled' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Cancel error');
    return fail(500, 'Failed to cancel booking');
  } finally {
    client.release();
  }
}

// ── Extend booking ─────────────────────────────────────────────────────────

export async function extendBooking(
  reservationId: string,
  newReturnTime: string,
): Promise<ServiceResult<{ status: string; new_return_time: string }>> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resCheck = await client.query(
      `SELECT id, status, rental_period FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(404, 'Booking not found');
    }

    if (resCheck.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return fail(400, `Cannot extend from '${resCheck.rows[0].status}' status. Booking must be 'active'.`);
    }

    await client.query(
      `UPDATE bookings.reservations
       SET rental_period = tstzrange(lower(rental_period), $2::timestamptz, '[)'),
           updated_at = NOW()
       WHERE id = $1`,
      [reservationId, newReturnTime],
    );

    await client.query(
      `UPDATE bookings.reservation_items
       SET rental_period = tstzrange(lower(rental_period), $2::timestamptz, '[)')
       WHERE reservation_id = $1
         AND checked_in_at IS NULL`,
      [reservationId, newReturnTime],
    );

    await client.query(
      `INSERT INTO bookings.notes (reservation_id, text, created_by)
       VALUES ($1, $2, 'admin')`,
      [reservationId, `Rental extended to ${newReturnTime}`],
    );

    await client.query('COMMIT');

    return ok({ status: 'extended', new_return_time: newReturnTime });
  } catch (err: any) {
    await client.query('ROLLBACK');

    if (err.code === '23P01') {
      return fail(409, 'Cannot extend: a bike in this booking conflicts with another reservation in the requested time range');
    }

    logger.error({ err }, 'Extend error');
    return fail(500, 'Failed to extend booking');
  } finally {
    client.release();
  }
}

// ── Complete booking ───────────────────────────────────────────────────────

export async function completeBooking(
  reservationId: string,
): Promise<ServiceResult<{ status: string }>> {
  try {
    const result = await pool.query(
      `UPDATE bookings.reservations SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND status IN ('paid', 'active')
       RETURNING id`,
      [reservationId],
    );

    if (result.rowCount === 0) {
      return fail(404, 'Booking not found or not in completable state');
    }

    return ok({ status: 'completed' });
  } catch (err) {
    logger.error({ err }, 'Complete booking error');
    return fail(500, 'Failed to complete booking');
  }
}

// ── Create walk-in ─────────────────────────────────────────────────────────

export interface WalkInInput {
  bikes: Array<{ bikeId: number }>;
  duration: string;
  endDate?: string;
  customer: {
    fullName: string;
    phone: string;
    email?: string;
  };
}

export interface WalkInResult {
  reservationId: string;
  bookingRef: string;
  bookingToken: string;
  status: string;
  waiverUrl: string;
  totalAmount: string;
  returnTime: string;
}

export async function createWalkIn(data: WalkInInput): Promise<ServiceResult<WalkInResult>> {
  const { bikes, duration, endDate, customer } = data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const email = customer.email || `walkin-${crypto.randomUUID()}@placeholder.local`;
    const customerId = await upsertCustomer(client, {
      fullName: customer.fullName,
      email,
      phone: customer.phone,
    });

    const bikeIds = bikes.map((b) => b.bikeId);

    // Calculate time range (walk-in uses current time, not date strings)
    const now = new Date();
    let rentalDays = 1;
    let endTime: Date;

    if (duration === 'multi-day') {
      // endDate is the last day of the rental (inclusive), end at midnight after it
      const end = new Date(endDate!);
      end.setDate(end.getDate() + 1);
      endTime = end;
      // Count days from today to endDate (inclusive)
      const today = new Date(now.toLocaleDateString('en-CA', { timeZone: TIMEZONE }));
      rentalDays = Math.max(1, Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    } else if (duration === '8h') {
      // Full Day: ends at 6 PM Calgary time
      endTime = new Date(
        now.toLocaleString('en-US', { timeZone: TIMEZONE }).replace(/,/, ''),
      );
      endTime.setHours(18, 0, 0, 0);
      if (endTime <= now) {
        endTime.setDate(endTime.getDate() + 1);
      }
    } else {
      const hours = DURATION_HOURS[duration];
      endTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    const bikesResult = await client.query(
      `SELECT id, name,
        CASE $2
          WHEN '2h' THEN price2h
          WHEN '4h' THEN price4h
          WHEN '8h' THEN price8h
          WHEN 'multi-day' THEN price_per_day
        END AS rental_price,
        deposit_amount, status
       FROM bikes WHERE id = ANY($1)`,
      [bikeIds, duration],
    );

    if (bikesResult.rowCount !== bikeIds.length) {
      const foundIds = bikesResult.rows.map((b: any) => b.id);
      const missing = bikeIds.filter((id) => !foundIds.includes(id));
      await client.query('ROLLBACK');
      return fail(404, `Bike(s) not found: ${missing.join(', ')}`);
    }

    const unavailable = bikesResult.rows.filter((b: any) => b.status !== 'available');
    if (unavailable.length > 0) {
      await client.query('ROLLBACK');
      return fail(400, `Bike(s) not available: ${unavailable.map((b: any) => b.name).join(', ')}`);
    }

    let totalRental = 0;
    let totalDeposit = 0;
    for (const bike of bikesResult.rows) {
      totalRental = roundCents(totalRental + parseFloat(bike.rental_price) * rentalDays);
      totalDeposit = roundCents(totalDeposit + parseFloat(bike.deposit_amount));
    }
    const totalAmount = roundCents(totalRental + totalDeposit);

    const resResult = await client.query(
      `INSERT INTO bookings.reservations
         (customer_id, rental_period, duration_type, status, source, total_amount, deposit_amount)
       VALUES
         ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4, 'active', 'walk-in', $5, $6)
       RETURNING id, booking_ref`,
      [customerId, now.toISOString(), endTime.toISOString(), duration, totalAmount, totalDeposit],
    );
    const reservationId = resResult.rows[0].id;
    const bookingRef = resResult.rows[0].booking_ref;

    for (const bike of bikesResult.rows) {
      await client.query(
        `INSERT INTO bookings.reservation_items
           (reservation_id, bike_id, rental_period, rental_price, deposit_amount, checked_out_at)
         VALUES
           ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), $5, $6, NOW())`,
        [reservationId, bike.id, now.toISOString(), endTime.toISOString(), bike.rental_price, bike.deposit_amount],
      );
    }

    await client.query('COMMIT');

    const bookingToken = generateBookingToken(bookingRef);

    return ok({
      reservationId,
      bookingRef,
      bookingToken,
      status: 'active',
      waiverUrl: `/waiver/${bookingRef}?token=${bookingToken}`,
      totalAmount: totalAmount.toFixed(2),
      returnTime: endTime.toISOString(),
    });
  } catch (err: any) {
    await client.query('ROLLBACK');

    if (err.code === '23P01') {
      return fail(409, 'One or more bikes are already booked for the requested time period');
    }

    logger.error({ err }, 'Walk-in error');
    return fail(500, 'Failed to create walk-in booking');
  } finally {
    client.release();
  }
}

// ── Add note ───────────────────────────────────────────────────────────────

export async function addNote(
  reservationId: string,
  text: string,
): Promise<ServiceResult<{ id: string; created_at: string }>> {
  try {
    const resCheck = await pool.query(
      `SELECT id FROM bookings.reservations WHERE id = $1`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      return fail(404, 'Booking not found');
    }

    const result = await pool.query(
      `INSERT INTO bookings.notes (reservation_id, text, created_by)
       VALUES ($1, $2, 'admin')
       RETURNING id, created_at`,
      [reservationId, text],
    );

    return ok({ id: result.rows[0].id, created_at: result.rows[0].created_at });
  } catch (err) {
    logger.error({ err }, 'Note creation error');
    return fail(500, 'Failed to add note');
  }
}

// ── Payment capture ────────────────────────────────────────────────────────

export async function capturePayment(
  reservationId: string,
): Promise<ServiceResult<{ status: string }>> {
  try {
    const reservation = await pool.query(
      `SELECT id, moneris_txn, deposit_amount FROM bookings.reservations WHERE id = $1 AND status = 'paid'`,
      [reservationId],
    );
    if (reservation.rowCount === 0) {
      return fail(404, 'Booking not found or not in paid state');
    }

    const { moneris_txn, deposit_amount } = reservation.rows[0];
    const result = await capture(moneris_txn, parseFloat(deposit_amount));

    if (!result.success) {
      return fail(500, result.message || 'Capture failed');
    }

    await pool.query(
      `UPDATE bookings.reservations SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [reservationId],
    );

    return ok({ status: 'captured' });
  } catch (err) {
    logger.error({ err }, 'Capture error');
    return fail(500, 'Failed to capture payment');
  }
}

// ── Payment void ───────────────────────────────────────────────────────────

export async function voidPayment(
  reservationId: string,
): Promise<ServiceResult<{ status: string }>> {
  try {
    const reservation = await pool.query(
      `SELECT id, moneris_txn FROM bookings.reservations WHERE id = $1 AND status = 'paid'`,
      [reservationId],
    );
    if (reservation.rowCount === 0) {
      return fail(404, 'Booking not found or not in paid state');
    }

    const result = await voidTransaction(reservation.rows[0].moneris_txn);

    if (!result.success) {
      return fail(500, result.message || 'Void failed');
    }

    await pool.query(
      `UPDATE bookings.reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [reservationId],
    );
    await pool.query(
      `UPDATE bookings.reservation_items
       SET rental_period = 'empty'::tstzrange
       WHERE reservation_id = $1
         AND NOT isempty(rental_period)`,
      [reservationId],
    );

    return ok({ status: 'voided' });
  } catch (err) {
    logger.error({ err }, 'Void error');
    return fail(500, 'Failed to void payment');
  }
}
