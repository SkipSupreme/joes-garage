import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { preAuthorize, capture, voidTransaction } from '../services/moneris.js';
import { sendBookingConfirmation, sendAdminNotification } from '../services/email.js';
import { getWaiverPdf } from '../services/storage.js';

export const bookingsRouter: IRouter = Router();

const MAX_RENTAL_DAYS = 30;

const holdSchema = z
  .object({
    bikeId: z.number().int().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine(
    (data) => {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (start < today) return false;
      if (end < start) return false;
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > MAX_RENTAL_DAYS) return false;

      return true;
    },
    { message: `Invalid date range. Start must be today or later. Max rental: ${MAX_RENTAL_DAYS} days.` },
  );

const paySchema = z.object({
  reservationId: z.string().uuid(),
  monerisToken: z.string().min(1).max(500),
});

const uuidParam = z.string().uuid();

/**
 * POST /api/bookings/hold
 * Creates a 15-minute hold on a bike for the given date range.
 */
bookingsRouter.post('/hold', async (req, res) => {
  const parsed = holdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { bikeId, startDate, endDate } = parsed.data;

  try {
    const bikeCheck = await pool.query(
      `SELECT id, price_per_day, deposit_amount FROM bikes WHERE id = $1 AND status = 'available'`,
      [bikeId],
    );
    if (bikeCheck.rowCount === 0) {
      res.status(404).json({ error: 'Bike not found or not available' });
      return;
    }

    const bike = bikeCheck.rows[0];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const rentalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const totalAmount = parseFloat(bike.price_per_day) * rentalDays + parseFloat(bike.deposit_amount);

    const result = await pool.query(
      `
      INSERT INTO bookings.reservations (bike_id, rental_dates, status, hold_expires, total_amount, deposit_amount)
      VALUES ($1, daterange($2::date, $3::date, '[]'), 'hold', NOW() + INTERVAL '15 minutes', $4, $5)
      RETURNING id, hold_expires
      `,
      [bikeId, startDate, endDate, totalAmount, bike.deposit_amount],
    );

    const reservation = result.rows[0];
    res.status(201).json({
      reservationId: reservation.id,
      holdExpiresAt: reservation.hold_expires,
    });
  } catch (err: any) {
    if (err.code === '23P01') {
      res.status(409).json({ error: 'This bike is no longer available for the selected dates' });
      return;
    }
    console.error('Hold creation error:', err);
    res.status(500).json({ error: 'Failed to create hold' });
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
      `SELECT r.*, w.id AS waiver_id, w.pdf_storage_key,
              c.full_name AS customer_name, c.email AS customer_email,
              b.name AS bike_name, b.type AS bike_type
       FROM bookings.reservations r
       LEFT JOIN bookings.waivers w ON w.reservation_id = r.id
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       LEFT JOIN bikes b ON b.id = r.bike_id
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

    if (!reservation.waiver_id) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Waiver must be signed before payment' });
      return;
    }

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

    // Extract date range from the reservation's rental_dates
    const rentalDates = reservation.rental_dates;
    // PostgreSQL daterange comes back as "[2025-07-01,2025-07-04)" or similar
    const dateMatch = rentalDates?.match(/[\[(]([\d-]+),([\d-]+)[)\]]/);
    const startDate = dateMatch?.[1] || '';
    const endDate = dateMatch?.[2] || '';

    const emailDetails = {
      bookingId: reservationId,
      confirmationNumber,
      customerName: reservation.customer_name || 'Customer',
      customerEmail: reservation.customer_email || '',
      bikeName: reservation.bike_name || 'Rental Bike',
      bikeType: reservation.bike_type || '',
      startDate,
      endDate,
      totalAmount: parseFloat(reservation.total_amount).toFixed(2),
      depositAmount: parseFloat(reservation.deposit_amount).toFixed(2),
      waiverStorageKey: reservation.pdf_storage_key || undefined,
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
      `SELECT r.id, r.bike_id, r.rental_dates, r.status, r.total_amount, r.deposit_amount,
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
      SELECT r.id, r.bike_id, r.rental_dates, r.status, r.total_amount,
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

    res.json(result.rows[0]);
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

