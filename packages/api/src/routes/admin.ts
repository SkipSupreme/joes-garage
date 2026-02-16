import { type Router as IRouter, Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import pool from '../db/pool.js';
import { capture, voidTransaction } from '../services/moneris.js';
import { getWaiverPdf } from '../services/storage.js';
import { generateBookingToken } from './bookings.js';
import { TIMEZONE, DURATION_HOURS, PRICE_COLUMN } from '../constants.js';

export const adminRouter: IRouter = Router();

// ── Validation schemas ──────────────────────────────────────────────────────

const uuidParam = z.string().uuid();

const bookingsQuerySchema = z.object({
  status: z.enum(['all', 'hold', 'paid', 'active', 'overdue', 'completed', 'cancelled']).default('all'),
  date: z.enum(['all', 'today', 'upcoming', 'past']).default('all'),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const checkOutSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
});

const checkInSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(2000).optional(),
});

const cancelSchema = z.object({
  reason: z.string().max(2000).optional(),
});

const extendSchema = z.object({
  newReturnTime: z.string().datetime({ offset: true }),
});

const noteSchema = z.object({
  text: z.string().min(1).max(2000),
});

const walkInSchema = z.object({
  bikes: z.array(z.object({ bikeId: z.number().int().positive() })).min(1).max(20),
  duration: z.enum(['2h', '4h', '8h']),
  customer: z.object({
    fullName: z.string().min(1).max(200),
    phone: z.string().min(1).max(30),
    email: z.string().email().max(200).optional(),
  }),
});

// ── 1. GET /dashboard ───────────────────────────────────────────────────────

adminRouter.get('/dashboard', async (_req, res) => {
  try {
    // KPI stats
    const statsResult = await pool.query(`
      SELECT
        -- Active rentals: bikes checked out but not returned
        (SELECT COUNT(*) FROM bookings.reservation_items ri
         JOIN bookings.reservations r ON r.id = ri.reservation_id
         WHERE r.status = 'active' AND ri.checked_out_at IS NOT NULL AND ri.checked_in_at IS NULL
        )::int AS active_rentals,

        -- Returns due today
        (SELECT COUNT(*) FROM bookings.reservation_items ri
         JOIN bookings.reservations r ON r.id = ri.reservation_id
         WHERE r.status = 'active'
           AND ri.checked_out_at IS NOT NULL
           AND ri.checked_in_at IS NULL
           AND upper(ri.rental_period) >= DATE_TRUNC('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1
           AND upper(ri.rental_period) < (DATE_TRUNC('day', NOW() AT TIME ZONE $1) + INTERVAL '1 day') AT TIME ZONE $1
        )::int AS returns_due_today,

        -- Overdue: past return time
        (SELECT COUNT(*) FROM bookings.reservation_items ri
         JOIN bookings.reservations r ON r.id = ri.reservation_id
         WHERE r.status = 'active'
           AND ri.checked_out_at IS NOT NULL
           AND ri.checked_in_at IS NULL
           AND upper(ri.rental_period) < NOW()
        )::int AS overdue_count,

        -- Available fleet
        (SELECT COUNT(*) FROM bikes WHERE status = 'available')::int AS available_fleet,

        -- Total fleet
        (SELECT COUNT(*) FROM bikes)::int AS total_fleet
    `, [TIMEZONE]);

    const stats = statsResult.rows[0];

    // Overdue alerts: details of overdue bikes
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

    // Unsigned waiver alerts: upcoming bookings (next 24h) missing waivers
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

    // Unlinked waivers signed today (available to attach to bookings)
    const unlinkedResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM bookings.waivers
      WHERE reservation_id IS NULL
        AND signed_at::date = CURRENT_DATE
    `);

    res.json({
      stats: { ...stats, waivers_ready: unlinkedResult.rows[0].count },
      alerts: {
        overdue: overdueResult.rows,
        unsigned_waivers: unsignedResult.rows,
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ── 2. GET /bookings ────────────────────────────────────────────────────────

adminRouter.get('/bookings', async (req, res) => {
  const parsed = bookingsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }

  const { status, date, search, page, limit } = parsed.data;
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  // Status filter
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

  // Date filter
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

  // Search filter (name, email, phone, booking ref, or UUID)
  if (search && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    conditions.push(`(c.full_name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx} OR c.phone ILIKE $${paramIdx} OR r.booking_ref ILIKE $${paramIdx} OR r.id::text ILIKE $${paramIdx})`);
    params.push(searchTerm);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM bookings.reservations r
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       ${whereClause}`,
      params,
    );
    const total = countResult.rows[0].total;
    const pages = Math.ceil(total / limit) || 1;

    // Fetch bookings with items and waivers as JSON sub-arrays
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
        -- is_overdue flag for sorting
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

    res.json({
      bookings: bookingsResult.rows,
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error('Bookings list error:', err);
    res.status(500).json({ error: 'Failed to list bookings' });
  }
});

// ── 3. GET /bookings/:id ────────────────────────────────────────────────────

adminRouter.get('/bookings/:id', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const reservationId = idParsed.data;

  try {
    // Reservation + customer
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
      [reservationId],
    );

    if (resResult.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const reservation = resResult.rows[0];

    // Items with bike details
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
      [reservationId],
    );

    // Waivers with signer info
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
      [reservationId],
    );

    // Notes
    const notesResult = await pool.query(
      `SELECT id, text, created_by, created_at
      FROM bookings.notes
      WHERE reservation_id = $1
      ORDER BY created_at DESC`,
      [reservationId],
    );

    // Compute is_overdue: any item checked out but not in, past return time
    const is_overdue = itemsResult.rows.some(
      (item: any) =>
        item.checked_out_at &&
        !item.checked_in_at &&
        item.return_time &&
        new Date(item.return_time) < new Date(),
    );

    res.json({
      ...reservation,
      items: itemsResult.rows,
      waivers: waiversResult.rows,
      notes: notesResult.rows,
      is_overdue,
    });
  } catch (err) {
    console.error('Booking detail error:', err);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

// ── 4. PATCH /bookings/:id/check-out ────────────────────────────────────────

adminRouter.patch('/bookings/:id/check-out', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = checkOutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const reservationId = idParsed.data;
  const { itemIds } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock and verify reservation status
    const resCheck = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const { status } = resCheck.rows[0];
    if (status !== 'paid' && status !== 'active') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Cannot check out from '${status}' status. Booking must be 'paid' or 'active'.` });
      return;
    }

    // Lock items to prevent concurrent check-out race conditions
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

    // Update items
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
      res.status(400).json({ error: 'No items to check out (already checked out or invalid IDs)' });
      return;
    }

    // Set booking status to active
    await client.query(
      `UPDATE bookings.reservations SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [reservationId],
    );

    await client.query('COMMIT');

    res.json({
      status: 'active',
      checked_out: updateResult.rowCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Check-out error:', err);
    res.status(500).json({ error: 'Failed to check out' });
  } finally {
    client.release();
  }
});

// ── 5. PATCH /bookings/:id/check-in ─────────────────────────────────────────

adminRouter.patch('/bookings/:id/check-in', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = checkInSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const reservationId = idParsed.data;
  const { itemIds, notes } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock and verify reservation status
    const resCheck = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    if (resCheck.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Cannot check in from '${resCheck.rows[0].status}' status. Booking must be 'active'.` });
      return;
    }

    // Lock items to prevent concurrent check-in race conditions
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

    // Check in items (only those that have been checked out)
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
      res.status(400).json({ error: 'No items to check in (not checked out or already returned)' });
      return;
    }

    // Add note if provided
    if (notes) {
      await client.query(
        `INSERT INTO bookings.notes (reservation_id, text, created_by) VALUES ($1, $2, 'admin')`,
        [reservationId, notes],
      );
    }

    // Check if ALL items are now checked in
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

    res.json({
      status: newStatus,
      checked_in: updateResult.rowCount,
      all_returned: allReturned,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Failed to check in' });
  } finally {
    client.release();
  }
});

// ── 6. PATCH /bookings/:id/cancel ───────────────────────────────────────────

adminRouter.patch('/bookings/:id/cancel', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = cancelSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const reservationId = idParsed.data;
  const { reason } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resCheck = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    if (!['hold', 'paid'].includes(resCheck.rows[0].status)) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Booking cannot be cancelled from current status (must be hold or paid)' });
      return;
    }

    await client.query(
      `UPDATE bookings.reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [reservationId],
    );

    if (reason) {
      await client.query(
        `INSERT INTO bookings.notes (reservation_id, text, created_by) VALUES ($1, $2, 'admin')`,
        [reservationId, `Cancelled: ${reason}`],
      );
    }

    await client.query('COMMIT');
    res.json({ status: 'cancelled' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel booking' });
  } finally {
    client.release();
  }
});

// ── 7. PATCH /bookings/:id/extend ───────────────────────────────────────────

adminRouter.patch('/bookings/:id/extend', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = extendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const reservationId = idParsed.data;
  const { newReturnTime } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock and verify reservation status
    const resCheck = await client.query(
      `SELECT id, status, rental_period FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    if (resCheck.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Cannot extend from '${resCheck.rows[0].status}' status. Booking must be 'active'.` });
      return;
    }

    // Update reservation rental_period upper bound
    await client.query(
      `UPDATE bookings.reservations
       SET rental_period = tstzrange(lower(rental_period), $2::timestamptz, '[)'),
           updated_at = NOW()
       WHERE id = $1`,
      [reservationId, newReturnTime],
    );

    // Update all unchecked-in items' rental_period upper bound
    await client.query(
      `UPDATE bookings.reservation_items
       SET rental_period = tstzrange(lower(rental_period), $2::timestamptz, '[)')
       WHERE reservation_id = $1
         AND checked_in_at IS NULL`,
      [reservationId, newReturnTime],
    );

    // Add note about extension
    await client.query(
      `INSERT INTO bookings.notes (reservation_id, text, created_by)
       VALUES ($1, $2, 'admin')`,
      [reservationId, `Rental extended to ${newReturnTime}`],
    );

    await client.query('COMMIT');

    res.json({ status: 'extended', new_return_time: newReturnTime });
  } catch (err: any) {
    await client.query('ROLLBACK');

    // Handle EXCLUDE constraint violation (bike already booked for the extended period)
    if (err.code === '23P01') {
      res.status(409).json({ error: 'Cannot extend: a bike in this booking conflicts with another reservation in the requested time range' });
      return;
    }

    console.error('Extend error:', err);
    res.status(500).json({ error: 'Failed to extend booking' });
  } finally {
    client.release();
  }
});

// ── 8. POST /bookings/:id/note ──────────────────────────────────────────────

adminRouter.post('/bookings/:id/note', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const reservationId = idParsed.data;

  try {
    // Verify reservation exists
    const resCheck = await pool.query(
      `SELECT id FROM bookings.reservations WHERE id = $1`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO bookings.notes (reservation_id, text, created_by)
       VALUES ($1, $2, 'admin')
       RETURNING id, created_at`,
      [reservationId, parsed.data.text],
    );

    res.status(201).json({
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
    });
  } catch (err) {
    console.error('Note creation error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// ── 9. POST /walk-in ────────────────────────────────────────────────────────

adminRouter.post('/walk-in', async (req, res) => {
  const parsed = walkInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { bikes, duration, customer } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create/upsert customer
    const email = customer.email || `walkin-${crypto.randomUUID()}@placeholder.local`;
    const customerResult = await client.query(
      `INSERT INTO bookings.customers (full_name, email, phone)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone
       RETURNING id`,
      [customer.fullName, email, customer.phone],
    );
    const customerId = customerResult.rows[0].id;

    // Fetch bike prices and validate availability
    const bikeIds = bikes.map((b) => b.bikeId);
    const bikesResult = await client.query(
      `SELECT id, name,
        CASE $2
          WHEN '2h' THEN price2h
          WHEN '4h' THEN price4h
          WHEN '8h' THEN price8h
        END AS rental_price,
        deposit_amount, status
       FROM bikes WHERE id = ANY($1)`,
      [bikeIds, duration],
    );

    if (bikesResult.rowCount !== bikeIds.length) {
      const foundIds = bikesResult.rows.map((b: any) => b.id);
      const missing = bikeIds.filter((id) => !foundIds.includes(id));
      await client.query('ROLLBACK');
      res.status(404).json({ error: `Bike(s) not found: ${missing.join(', ')}` });
      return;
    }

    const unavailable = bikesResult.rows.filter((b: any) => b.status !== 'available');
    if (unavailable.length > 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Bike(s) not available: ${unavailable.map((b: any) => b.name).join(', ')}` });
      return;
    }

    // Calculate time range
    const now = new Date();
    let endTime: Date;

    if (duration === '8h') {
      // Full day: end at 6 PM local time today
      endTime = new Date(
        now.toLocaleString('en-US', { timeZone: TIMEZONE }).replace(/,/, ''),
      );
      endTime.setHours(18, 0, 0, 0);
      // If it's already past 6 PM, extend to tomorrow 6 PM
      if (endTime <= now) {
        endTime.setDate(endTime.getDate() + 1);
      }
    } else {
      const hours = DURATION_HOURS[duration];
      endTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    // Calculate totals
    let totalRental = 0;
    let totalDeposit = 0;
    for (const bike of bikesResult.rows) {
      totalRental += parseFloat(bike.rental_price);
      totalDeposit += parseFloat(bike.deposit_amount);
    }
    const totalAmount = totalRental + totalDeposit;

    // Create reservation
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

    // Create reservation_items with checked_out_at = NOW()
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

    res.status(201).json({
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

    // Handle EXCLUDE constraint violation
    if (err.code === '23P01') {
      res.status(409).json({ error: 'One or more bikes are already booked for the requested time period' });
      return;
    }

    console.error('Walk-in error:', err);
    res.status(500).json({ error: 'Failed to create walk-in booking' });
  } finally {
    client.release();
  }
});

// ── 10. GET /fleet ──────────────────────────────────────────────────────────

adminRouter.get('/fleet', async (_req, res) => {
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

    res.json({ fleet: result.rows });
  } catch (err) {
    console.error('Fleet status error:', err);
    res.status(500).json({ error: 'Failed to load fleet status' });
  }
});

// ── 11. GET /waivers/unlinked ─────────────────────────────────────────────

adminRouter.get('/waivers/unlinked', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        w.id AS waiver_id,
        c.full_name,
        c.email,
        c.phone,
        w.signed_at,
        w.is_minor
      FROM bookings.waivers w
      JOIN bookings.customers c ON w.customer_id = c.id
      WHERE w.reservation_id IS NULL
        AND w.signed_at::date = CURRENT_DATE
      ORDER BY w.signed_at DESC
    `);
    res.json({ waivers: result.rows });
  } catch (err) {
    console.error('Unlinked waivers error:', err);
    res.status(500).json({ error: 'Failed to fetch unlinked waivers' });
  }
});

// ── 12. PATCH /bookings/:id/link-waivers ─────────────────────────────────

const linkWaiversSchema = z.object({
  waiverIds: z.array(z.string().uuid()).min(1).max(20),
});

adminRouter.patch('/bookings/:id/link-waivers', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = linkWaiversSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const reservationId = idParsed.data;
  const { waiverIds } = parsed.data;

  try {
    const resCheck = await pool.query(
      `SELECT id FROM bookings.reservations WHERE id = $1`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const updateResult = await pool.query(
      `UPDATE bookings.waivers
       SET reservation_id = $1
       WHERE id = ANY($2)
         AND reservation_id IS NULL
       RETURNING id`,
      [reservationId, waiverIds],
    );

    // Link first waiver's customer to reservation if it has no customer yet
    if (updateResult.rowCount && updateResult.rowCount > 0) {
      const firstWaiver = await pool.query(
        `SELECT customer_id FROM bookings.waivers WHERE id = $1`,
        [updateResult.rows[0].id],
      );
      if (firstWaiver.rows[0]?.customer_id) {
        await pool.query(
          `UPDATE bookings.reservations
           SET customer_id = COALESCE(customer_id, $2), updated_at = NOW()
           WHERE id = $1`,
          [reservationId, firstWaiver.rows[0].customer_id],
        );
      }
    }

    res.json({
      linked: updateResult.rowCount || 0,
      message: `${updateResult.rowCount || 0} waiver(s) linked to booking`,
    });
  } catch (err) {
    console.error('Link waivers error:', err);
    res.status(500).json({ error: 'Failed to link waivers' });
  }
});

// ── 13. POST /bookings/:id/capture — Capture pre-authorized payment ────

adminRouter.post('/bookings/:id/capture', async (req, res) => {
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

// ── 14. POST /bookings/:id/void — Void pre-authorized payment ──────────

adminRouter.post('/bookings/:id/void', async (req, res) => {
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

// ── 15. POST /bookings/:id/complete — Mark rental as returned ───────────

adminRouter.post('/bookings/:id/complete', async (req, res) => {
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

// ── 16. GET /bookings/:id/waiver — Download signed waiver PDF ───────────

adminRouter.get('/bookings/:id/waiver', async (req, res) => {
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
