import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { preAuthorize, capture, voidTransaction } from '../services/moneris.js';
import { sendBookingConfirmation, sendAdminNotification } from '../services/email.js';
import { getWaiverPdf } from '../services/storage.js';

export const bookingsRouter: IRouter = Router();

const MAX_RENTAL_DAYS = 30;
const TIMEZONE = 'America/Edmonton';
const DURATION_HOURS: Record<string, number> = { '2h': 2, '4h': 4, '8h': 8 };

/**
 * Map duration type → price column in the bikes table.
 */
const PRICE_COLUMN: Record<string, string> = {
  '2h': 'price2h',
  '4h': 'price4h',
  '8h': 'price8h',
  'multi-day': 'price_per_day',
};

const DURATION_LABELS: Record<string, string> = {
  '2h': '2 Hours',
  '4h': '4 Hours',
  '8h': 'Full Day',
  'multi-day': 'Multi-Day',
};

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
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { bikes, date, duration, startTime, endDate } = parsed.data;
  const priceCol = PRICE_COLUMN[duration];
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
      `SELECT id, ${priceCol} AS rental_price, price8h, price_per_day, deposit_amount
       FROM bikes WHERE id = ANY($1) AND status = 'available'`,
      [bikeIds],
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
      RETURNING id, hold_expires
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
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
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

    // Respond immediately — emails are fire-and-forget
    res.json({
      bookingId: reservationId,
      confirmationNumber,
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
 * GET /api/bookings/admin/list — List all bookings for admin dashboard.
 * Must be registered BEFORE /:id to avoid Express treating "admin" as a UUID param.
 */
bookingsRouter.get('/admin/list', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.bike_id, r.rental_period, r.duration_type, r.status, r.total_amount, r.deposit_amount,
              r.created_at, r.hold_expires,
              c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
              b.name AS bike_name, b.type AS bike_type,
              w.id AS waiver_id, w.signed_at AS waiver_signed_at
       FROM bookings.reservations r
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       LEFT JOIN bikes b ON b.id = r.bike_id
       LEFT JOIN bookings.waivers w ON w.reservation_id = r.id
       WHERE r.status NOT IN ('cancelled')
       ORDER BY r.created_at DESC
       LIMIT 100`,
    );

    res.json({ bookings: result.rows });
  } catch (err) {
    console.error('Admin list error:', err);
    res.status(500).json({ error: 'Failed to list bookings' });
  }
});

/**
 * GET /api/bookings/:id
 * Returns booking confirmation details (limited public info).
 * Includes items[] array with per-bike details for multi-bike bookings.
 */
bookingsRouter.get('/:id', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  try {
    const result = await pool.query(
      `
      SELECT r.id, r.bike_id, r.rental_period, r.duration_type, r.status,
             r.total_amount, r.deposit_amount,
             (r.total_amount - r.deposit_amount) AS rental_amount,
             r.created_at, c.full_name, c.email,
             b.name AS bike_name, b.type AS bike_type
      FROM bookings.reservations r
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      LEFT JOIN bikes b ON b.id = r.bike_id
      WHERE r.id = $1 AND r.status IN ('paid', 'active', 'completed')
      `,
      [idParsed.data],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    // Fetch reservation items for multi-bike details
    const itemsResult = await pool.query(
      `SELECT ri.bike_id, ri.rental_price, ri.deposit_amount,
              b.name AS bike_name, b.type AS bike_type
       FROM bookings.reservation_items ri
       JOIN bikes b ON b.id = ri.bike_id
       WHERE ri.reservation_id = $1
       ORDER BY ri.created_at`,
      [idParsed.data],
    );

    const booking = result.rows[0];
    booking.items = itemsResult.rows;
    booking.item_count = itemsResult.rows.length || 1; // At least 1 (legacy single-bike)

    res.json(booking);
  } catch (err) {
    console.error('Booking fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

/**
 * POST /api/bookings/:id/capture — Capture pre-authorized payment (admin).
 */
bookingsRouter.post('/:id/capture', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  try {
    const reservation = await pool.query(
      `SELECT id, moneris_txn, deposit_amount FROM bookings.reservations WHERE id = $1 AND status = 'paid'`,
      [idParsed.data],
    );
    if (reservation.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found or not in paid state' });
      return;
    }

    const { moneris_txn, deposit_amount } = reservation.rows[0];
    const result = await capture(moneris_txn, parseFloat(deposit_amount));

    if (!result.success) {
      res.status(500).json({ error: result.message || 'Capture failed' });
      return;
    }

    await pool.query(
      `UPDATE bookings.reservations SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [idParsed.data],
    );

    res.json({ status: 'captured' });
  } catch (err) {
    console.error('Capture error:', err);
    res.status(500).json({ error: 'Failed to capture payment' });
  }
});

/**
 * POST /api/bookings/:id/void — Void pre-authorized payment (admin).
 */
bookingsRouter.post('/:id/void', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  try {
    const reservation = await pool.query(
      `SELECT id, moneris_txn FROM bookings.reservations WHERE id = $1 AND status = 'paid'`,
      [idParsed.data],
    );
    if (reservation.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found or not in paid state' });
      return;
    }

    const result = await voidTransaction(reservation.rows[0].moneris_txn);

    if (!result.success) {
      res.status(500).json({ error: result.message || 'Void failed' });
      return;
    }

    await pool.query(
      `UPDATE bookings.reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [idParsed.data],
    );

    res.json({ status: 'voided' });
  } catch (err) {
    console.error('Void error:', err);
    res.status(500).json({ error: 'Failed to void payment' });
  }
});

/**
 * POST /api/bookings/:id/complete — Mark rental as returned (admin).
 */
bookingsRouter.post('/:id/complete', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE bookings.reservations SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND status IN ('paid', 'active')
       RETURNING id`,
      [idParsed.data],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found or not in completable state' });
      return;
    }

    res.json({ status: 'completed' });
  } catch (err) {
    console.error('Complete booking error:', err);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

/**
 * GET /api/bookings/:id/waiver — Download signed waiver PDF (admin).
 */
bookingsRouter.get('/:id/waiver', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT w.pdf_storage_key, c.full_name
       FROM bookings.waivers w
       JOIN bookings.reservations r ON r.id = w.reservation_id
       LEFT JOIN bookings.customers c ON w.customer_id = c.id
       WHERE r.id = $1`,
      [idParsed.data],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Waiver not found for this booking' });
      return;
    }

    const { pdf_storage_key, full_name } = result.rows[0];
    const pdfBuffer = await getWaiverPdf(pdf_storage_key);
    const safeName = (full_name || 'waiver').replace(/[^a-zA-Z0-9-_ ]/g, '').trim();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="waiver-${safeName}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Waiver download error:', err);
    res.status(500).json({ error: 'Failed to download waiver' });
  }
});
