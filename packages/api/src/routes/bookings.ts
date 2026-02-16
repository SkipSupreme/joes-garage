import { type Router as IRouter, Router } from 'express';
import { createHmac } from 'crypto';
import { z } from 'zod';
import pool from '../db/pool.js';
import { preAuthorize } from '../services/moneris.js';
import { sendBookingConfirmation, sendAdminNotification } from '../services/email.js';
import { TIMEZONE, DURATION_HOURS, PRICE_COLUMN, DURATION_LABELS } from '../constants.js';

export const bookingsRouter: IRouter = Router();

const MAX_RENTAL_DAYS = 30;

const BOOKING_HMAC_SECRET = process.env.BOOKING_HMAC_SECRET || 'dev-booking-hmac-secret';

/** Generate a short HMAC token for a booking ref (used in confirmation URLs) */
export function generateBookingToken(bookingRef: string): string {
  return createHmac('sha256', BOOKING_HMAC_SECRET)
    .update(bookingRef.toUpperCase())
    .digest('hex')
    .slice(0, 12);
}

const holdSchema = z
  .object({
    bikes: z.array(z.object({ bikeId: z.number().int().positive() })).min(1).max(10),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    duration: z.enum(['2h', '4h', '8h', 'multi-day']),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (data) => {
      if (data.duration === 'multi-day') return !!data.endDate;
      if (data.duration === '8h') return true; // Full Day uses fixed shop hours
      return !!data.startTime;
    },
    { message: '2h/4h rentals require startTime; multi-day requires endDate' },
  )
  .refine(
    (data) => {
      const start = new Date(data.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start < today) return false;

      if (data.duration === 'multi-day' && data.endDate) {
        const end = new Date(data.endDate);
        if (end < start) return false;
        const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > MAX_RENTAL_DAYS) return false;
      }
      return true;
    },
    { message: `Invalid dates. Start must be today or later. Max rental: ${MAX_RENTAL_DAYS} days.` },
  );

const paySchema = z.object({
  reservationId: z.string().uuid(),
  monerisToken: z.string().min(1).max(500),
});

const uuidParam = z.string().uuid();

/**
 * Build TSTZRANGE start/end strings from hold params.
 */
function buildRangeBounds(
  date: string,
  duration: string,
  startTime?: string,
  endDate?: string,
): { rangeStart: string; rangeEnd: string } {
  if (duration === 'multi-day') {
    const end = new Date(endDate!);
    end.setDate(end.getDate() + 1);
    return {
      rangeStart: `${date} 00:00`,
      rangeEnd: `${end.toISOString().split('T')[0]} 00:00`,
    };
  }

  if (duration === '8h') {
    // Full Day: fixed shop hours 9:30 AM – 6:00 PM
    return {
      rangeStart: `${date} 09:30`,
      rangeEnd: `${date} 18:00`,
    };
  }

  // Hourly (2h/4h)
  const hours = DURATION_HOURS[duration];
  const [h, m] = startTime!.split(':').map(Number);
  const endH = h + hours;
  const rangeStart = `${date} ${startTime}`;
  let rangeEnd: string;

  if (endH >= 24) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    rangeEnd = `${nextDate.toISOString().split('T')[0]} ${String(endH - 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } else {
    rangeEnd = `${date} ${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return { rangeStart, rangeEnd };
}

/**
 * POST /api/bookings/hold
 * Creates a 15-minute hold on one or more bikes for the given period.
 * Accepts both old format { bikeId, ... } and new format { bikes: [{ bikeId }], ... }
 */
bookingsRouter.post('/hold', async (req, res) => {
  // Backward compat: normalize old single-bike format to new multi-bike format
  if (req.body.bikeId && !req.body.bikes) {
    req.body.bikes = [{ bikeId: req.body.bikeId }];
    delete req.body.bikeId;
  }

  const parsed = holdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { bikes, date, duration, startTime, endDate } = parsed.data;
  const bikeIds = bikes.map((b) => b.bikeId);

  // Check for duplicate bike IDs in the request
  if (new Set(bikeIds).size !== bikeIds.length) {
    res.status(400).json({ error: 'Duplicate bike IDs in request' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch all requested bikes in one query
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
      res.status(404).json({ error: `Bike(s) not found or not available: ${missing.join(', ')}` });
      return;
    }

    const { rangeStart, rangeEnd } = buildRangeBounds(date, duration, startTime, endDate);

    // Calculate per-bike costs and totals
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
        // Inclusive day count: booking Feb 1→Feb 3 = 3 rental days (Feb 1, Feb 2, Feb 3)
        // The +1 is for inclusive date counting; buildRangeBounds separately adds +1 for the exclusive tstzrange upper bound
        const rentalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const firstDay = parseFloat(bike.price8h);
        const additionalRate = parseFloat(bike.price_per_day);
        rentalCost = firstDay + additionalRate * Math.max(0, rentalDays - 1);
      } else {
        rentalCost = parseFloat(bike.rental_price);
      }
      const deposit = parseFloat(bike.deposit_amount);
      totalRentalCost += rentalCost;
      totalDeposit += deposit;
      itemDetails.push({ bikeId, rentalPrice: rentalCost, depositAmount: deposit });
    }

    const totalAmount = totalRentalCost + totalDeposit;

    // Create the reservation (bike_id set to first bike for legacy compat)
    const result = await client.query(
      `
      INSERT INTO bookings.reservations (bike_id, rental_period, duration_type, status, hold_expires, total_amount, deposit_amount)
      VALUES (
        $1,
        tstzrange($2::timestamp AT TIME ZONE $6, $3::timestamp AT TIME ZONE $6, '[)'),
        $4,
        'hold',
        NOW() + INTERVAL '15 minutes',
        $5,
        $7
      )
      RETURNING id, booking_ref, hold_expires
      `,
      [bikeIds[0], rangeStart, rangeEnd, duration, totalAmount, TIMEZONE, totalDeposit],
    );

    const reservation = result.rows[0];
    const reservationId = reservation.id;

    // Create reservation_items (one per bike)
    for (const item of itemDetails) {
      await client.query(
        `
        INSERT INTO bookings.reservation_items (reservation_id, bike_id, rental_period, rental_price, deposit_amount)
        VALUES (
          $1,
          $2,
          tstzrange($3::timestamp AT TIME ZONE $6, $4::timestamp AT TIME ZONE $6, '[)'),
          $5,
          $7
        )
        `,
        [reservationId, item.bikeId, rangeStart, rangeEnd, item.rentalPrice, TIMEZONE, item.depositAmount],
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      reservationId,
      bookingRef: reservation.booking_ref,
      bookingToken: generateBookingToken(reservation.booking_ref),
      holdExpiresAt: reservation.hold_expires,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23P01') {
      res.status(409).json({ error: 'One or more bikes are no longer available for the selected time' });
      return;
    }
    console.error('Hold creation error:', err);
    res.status(500).json({ error: 'Failed to create hold' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/bookings/pay
 * Processes payment via Moneris and confirms the booking.
 */
bookingsRouter.post('/pay', async (req, res) => {
  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { reservationId, monerisToken } = parsed.data;
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
      res.status(404).json({ error: 'Reservation not found or hold expired' });
      return;
    }

    const reservation = holdCheck.rows[0];

    // Check at least one waiver exists
    const waiverCheck = await client.query(
      `SELECT w.id, w.pdf_storage_key FROM bookings.waivers w WHERE w.reservation_id = $1 LIMIT 1`,
      [reservationId],
    );
    if (waiverCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Waiver must be signed before payment' });
      return;
    }
    const firstWaiver = waiverCheck.rows[0];

    // Pre-authorize the deposit via Moneris
    const amount = parseFloat(reservation.deposit_amount || reservation.total_amount);
    const monerisResult = await preAuthorize(monerisToken, amount, reservationId);

    if (!monerisResult.success) {
      await client.query('ROLLBACK');
      res.status(402).json({ error: monerisResult.message || 'Payment declined' });
      return;
    }

    await client.query(
      `
      UPDATE bookings.reservations
      SET status = 'paid', payment_token = $2, moneris_txn = $3, updated_at = NOW()
      WHERE id = $1
      `,
      [reservationId, monerisToken, monerisResult.transactionId],
    );

    await client.query('COMMIT');

    const confirmationNumber = reservationId.split('-')[0].toUpperCase();

    // Fetch booking_ref for the token
    const bookingRefResult = await pool.query(
      `SELECT booking_ref FROM bookings.reservations WHERE id = $1`,
      [reservationId],
    );
    const bookingRef = bookingRefResult.rows[0]?.booking_ref || '';

    // Respond immediately — emails are fire-and-forget
    res.json({
      bookingId: reservationId,
      confirmationNumber,
      bookingRef,
      bookingToken: generateBookingToken(bookingRef),
      status: 'paid',
    });

    // Extract period from the reservation's rental_period
    // PostgreSQL tstzrange comes back as ["2026-07-01 16:00:00+00","2026-07-01 20:00:00+00")
    const rentalPeriod = reservation.rental_period;
    const periodMatch = rentalPeriod?.match(/[\[(]([\d\s:.+-]+),([\d\s:.+-]+)[)\]]/);
    const startTimestamp = periodMatch?.[1]?.trim() || '';
    const endTimestamp = periodMatch?.[2]?.trim() || '';

    // Fetch all bikes from reservation_items for the email
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

    // Fallback to legacy bike_id join if no reservation_items exist (old bookings)
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

    // Fire-and-forget: don't await, just log failures
    if (emailDetails.customerEmail) {
      sendBookingConfirmation(emailDetails).catch((err) =>
        console.error('Failed to send confirmation email:', err),
      );
    }
    sendAdminNotification(emailDetails).catch((err) =>
      console.error('Failed to send admin notification:', err),
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Payment processing error:', err);
    res.status(500).json({ error: 'Failed to process payment' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/bookings/:id
 * Returns booking confirmation details (limited public info).
 * Accepts UUID or short booking_ref (e.g. "A3F2XY").
 * Includes items[] array with per-bike details for multi-bike bookings.
 */
bookingsRouter.get('/:id', async (req, res) => {
  const param = req.params.id;
  const isUuid = uuidParam.safeParse(param).success;
  const isRef = /^[A-Z0-9]{6}$/i.test(param);

  if (!isUuid && !isRef) {
    res.status(400).json({ error: 'Invalid booking ID or reference' });
    return;
  }

  // HMAC token validation for booking ref lookups (prevents enumeration)
  if (isRef) {
    const token = req.query.token as string | undefined;
    if (!token || token !== generateBookingToken(param.toUpperCase())) {
      res.status(403).json({ error: 'Invalid or missing booking token' });
      return;
    }
  }

  try {
    const whereClause = isUuid
      ? 'r.id = $1'
      : 'UPPER(r.booking_ref) = UPPER($1)';

    const result = await pool.query(
      `
      SELECT r.id, r.booking_ref, r.bike_id, r.rental_period, r.duration_type, r.status,
             r.total_amount, r.deposit_amount,
             (r.total_amount - r.deposit_amount) AS rental_amount,
             r.created_at, c.full_name, c.email,
             b.name AS bike_name, b.type AS bike_type
      FROM bookings.reservations r
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      LEFT JOIN bikes b ON b.id = r.bike_id
      WHERE ${whereClause} AND r.status IN ('hold', 'paid', 'active', 'completed')
      `,
      [param],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const bookingId = result.rows[0].id;

    // Fetch reservation items for multi-bike details
    const itemsResult = await pool.query(
      `SELECT ri.bike_id, ri.rental_price, ri.deposit_amount,
              b.name AS bike_name, b.type AS bike_type
       FROM bookings.reservation_items ri
       JOIN bikes b ON b.id = ri.bike_id
       WHERE ri.reservation_id = $1
       ORDER BY ri.created_at`,
      [bookingId],
    );

    // Fetch waivers for this booking (needed by QR waiver page)
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
    booking.item_count = itemsResult.rows.length || 1; // At least 1 (legacy single-bike)
    booking.waivers = waiversResult.rows;

    res.json(booking);
  } catch (err) {
    console.error('Booking fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

