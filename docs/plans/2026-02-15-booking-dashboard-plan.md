# Booking Dashboard & Multi-Bike Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full booking management dashboard inside Payload CMS with multi-bike booking support, walk-in flow, and QR waiver system.

**Architecture:** Custom Payload v3 admin view (React server+client components) fetching from Express API. Database schema expanded with `reservation_items` table for multi-bike bookings. New admin API routes for dashboard data and booking lifecycle management. QR waiver page on Astro frontend.

**Tech Stack:** Payload CMS 3.x (Next.js), Express API, PostgreSQL, Alpine.js, Astro, React (admin components)

**Design Doc:** `docs/plans/2026-02-15-booking-dashboard-design.md`

---

## Batch 1: Database Migration (Multi-Bike Schema)

### Task 1: Create migration file for multi-bike booking schema

**Files:**
- Create: `packages/api/src/db/migrations/003_multi_bike_bookings.sql`

**Step 1: Write the migration**

```sql
-- Migration 003: Multi-bike bookings
-- Adds reservation_items table (one row per bike per booking),
-- source column, minor waiver support, and booking notes.

BEGIN;

-- 1. Create reservation_items table
CREATE TABLE bookings.reservation_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  UUID NOT NULL REFERENCES bookings.reservations(id) ON DELETE CASCADE,
  bike_id         INTEGER NOT NULL,
  rental_period   TSTZRANGE NOT NULL,
  rental_price    NUMERIC(10,2) NOT NULL,
  deposit_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  checked_out_at  TIMESTAMPTZ,
  checked_in_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- EXCLUDE constraint: same bike can't overlap in time (prevents double-booking)
ALTER TABLE bookings.reservation_items
  ADD CONSTRAINT items_bike_period_excl
  EXCLUDE USING gist (bike_id WITH =, rental_period WITH &&);

CREATE INDEX idx_reservation_items_reservation ON bookings.reservation_items(reservation_id);
CREATE INDEX idx_reservation_items_bike ON bookings.reservation_items(bike_id);
CREATE INDEX idx_reservation_items_period ON bookings.reservation_items USING gist (rental_period);

-- 2. Add source column to reservations
ALTER TABLE bookings.reservations
  ADD COLUMN source TEXT NOT NULL DEFAULT 'website'
  CHECK (source IN ('website', 'walk-in', 'phone'));

-- 3. Add minor/guardian support to waivers
ALTER TABLE bookings.waivers
  ADD COLUMN is_minor BOOLEAN DEFAULT false,
  ADD COLUMN guardian_customer_id UUID REFERENCES bookings.customers(id);

-- 4. Create booking notes table
CREATE TABLE bookings.notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  UUID NOT NULL REFERENCES bookings.reservations(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  created_by      TEXT NOT NULL DEFAULT 'admin',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notes_reservation ON bookings.notes(reservation_id);

-- 5. Migrate existing single-bike data into reservation_items
INSERT INTO bookings.reservation_items (reservation_id, bike_id, rental_period, rental_price, deposit_amount)
SELECT
  r.id,
  r.bike_id,
  r.rental_period,
  COALESCE(r.total_amount - r.deposit_amount, 0),
  COALESCE(r.deposit_amount, 0)
FROM bookings.reservations r
WHERE r.bike_id IS NOT NULL;

-- 6. Drop old EXCLUDE constraint on reservations (items table handles this now)
ALTER TABLE bookings.reservations
  DROP CONSTRAINT IF EXISTS reservations_bike_id_rental_period_excl;

-- 7. Make bike_id nullable (items table owns the relationship now)
-- Keep column temporarily for backward compatibility during rollout
ALTER TABLE bookings.reservations
  ALTER COLUMN bike_id DROP NOT NULL;

COMMIT;
```

**Step 2: Run migration**

Run: `cd packages/api && npx tsx src/db/migrate.ts`
Expected: `apply: 003_multi_bike_bookings.sql` then `Migrations complete.`

**Step 3: Verify schema**

Run: `psql postgresql://postgres:postgres@localhost:5434/joes_garage -c "\d bookings.reservation_items"`
Expected: Table with columns: id, reservation_id, bike_id, rental_period, rental_price, deposit_amount, checked_out_at, checked_in_at, created_at

Run: `psql postgresql://postgres:postgres@localhost:5434/joes_garage -c "SELECT count(*) FROM bookings.reservation_items"`
Expected: Count matches existing non-null bike_id reservations

Run: `psql postgresql://postgres:postgres@localhost:5434/joes_garage -c "\d bookings.notes"`
Expected: Table with columns: id, reservation_id, text, created_by, created_at

Run: `psql postgresql://postgres:postgres@localhost:5434/joes_garage -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='bookings' AND table_name='reservations' AND column_name='source'"`
Expected: source column exists with type text

**Step 4: Commit**

```bash
git add packages/api/src/db/migrations/003_multi_bike_bookings.sql
git commit -m "feat: add multi-bike booking schema (reservation_items, notes, source)"
```

---

## Batch 2: Admin API Router (Dashboard + Management Endpoints)

### Task 2: Create admin router with dashboard stats endpoint

**Files:**
- Create: `packages/api/src/routes/admin.ts`
- Modify: `packages/api/src/server.ts`

**Step 1: Create the admin router file with dashboard endpoint**

Create `packages/api/src/routes/admin.ts`:

```typescript
import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';

export const adminRouter: IRouter = Router();

const TIMEZONE = 'America/Edmonton';

/**
 * GET /api/admin/dashboard
 * Returns KPI stats and alerts for the booking dashboard.
 */
adminRouter.get('/dashboard', async (_req, res) => {
  try {
    // KPIs: active rentals, returns due today, overdue, available fleet
    const stats = await pool.query(`
      WITH now_tz AS (
        SELECT NOW() AT TIME ZONE '${TIMEZONE}' AS now_local
      ),
      today_bounds AS (
        SELECT
          date_trunc('day', now_local)::timestamp AT TIME ZONE '${TIMEZONE}' AS day_start,
          (date_trunc('day', now_local) + INTERVAL '1 day')::timestamp AT TIME ZONE '${TIMEZONE}' AS day_end
        FROM now_tz
      ),
      active_items AS (
        SELECT ri.*
        FROM bookings.reservation_items ri
        JOIN bookings.reservations r ON r.id = ri.reservation_id
        WHERE r.status = 'active'
          AND ri.checked_out_at IS NOT NULL
          AND ri.checked_in_at IS NULL
      ),
      overdue_items AS (
        SELECT ri.*, r.customer_id
        FROM bookings.reservation_items ri
        JOIN bookings.reservations r ON r.id = ri.reservation_id
        WHERE r.status = 'active'
          AND ri.checked_out_at IS NOT NULL
          AND ri.checked_in_at IS NULL
          AND upper(ri.rental_period) < NOW()
      )
      SELECT
        (SELECT count(*) FROM active_items)::int AS active_rentals,
        (SELECT count(*)
         FROM bookings.reservation_items ri
         JOIN bookings.reservations r ON r.id = ri.reservation_id
         WHERE r.status IN ('paid', 'active')
           AND ri.checked_in_at IS NULL
           AND upper(ri.rental_period) >= (SELECT day_start FROM today_bounds)
           AND upper(ri.rental_period) < (SELECT day_end FROM today_bounds)
        )::int AS returns_due_today,
        (SELECT count(*) FROM overdue_items)::int AS overdue_count,
        (SELECT count(*)
         FROM bikes
         WHERE status = 'available'
           AND id NOT IN (SELECT bike_id FROM active_items)
        )::int AS available_fleet,
        (SELECT count(*) FROM bikes WHERE status = 'available')::int AS total_fleet
    `);

    // Alerts: overdue details + unsigned waivers on upcoming bookings
    const overdueAlerts = await pool.query(`
      SELECT r.id AS reservation_id, r.rental_period, r.duration_type,
             c.full_name AS customer_name, c.phone AS customer_phone,
             b.name AS bike_name, b.type AS bike_type,
             upper(ri.rental_period) AS due_at
      FROM bookings.reservation_items ri
      JOIN bookings.reservations r ON r.id = ri.reservation_id
      JOIN bikes b ON b.id = ri.bike_id
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      WHERE r.status = 'active'
        AND ri.checked_out_at IS NOT NULL
        AND ri.checked_in_at IS NULL
        AND upper(ri.rental_period) < NOW()
      ORDER BY upper(ri.rental_period) ASC
      LIMIT 10
    `);

    const waiverAlerts = await pool.query(`
      SELECT r.id AS reservation_id, r.rental_period,
             c.full_name AS customer_name,
             (SELECT count(*) FROM bookings.reservation_items ri2 WHERE ri2.reservation_id = r.id)::int AS bike_count,
             (SELECT count(*) FROM bookings.waivers w WHERE w.reservation_id = r.id)::int AS waiver_count
      FROM bookings.reservations r
      LEFT JOIN bookings.customers c ON r.customer_id = c.id
      WHERE r.status = 'paid'
        AND lower(r.rental_period) BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
        AND (SELECT count(*) FROM bookings.waivers w WHERE w.reservation_id = r.id)
            < (SELECT count(*) FROM bookings.reservation_items ri3 WHERE ri3.reservation_id = r.id)
      ORDER BY lower(r.rental_period) ASC
      LIMIT 10
    `);

    res.json({
      stats: stats.rows[0],
      alerts: {
        overdue: overdueAlerts.rows,
        unsigned_waivers: waiverAlerts.rows,
      },
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});
```

**Step 2: Mount admin router in server.ts**

In `packages/api/src/server.ts`, add the import and mount:

After the existing imports, add:
```typescript
import { adminRouter } from './routes/admin.js';
```

After the existing route mounts (after line `app.use('/api/contact', bookingLimiter, contactRouter);`), add:
```typescript
app.use('/api/admin', adminRouter);
```

Also update the CORS config to allow PATCH method (needed for admin actions) and allow the CMS origin. Change the `methods` line:
```typescript
methods: ['GET', 'POST', 'PATCH'],
```

And add the CMS origin to `allowedOrigins`:
```typescript
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4321,http://localhost:3003')
  .split(',')
  .map((o) => o.trim());
```

**Step 3: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

Run: `cd packages/api && npm run dev` (in background)
Then: `curl -s http://localhost:3001/api/admin/dashboard | jq .`
Expected: JSON with `stats` and `alerts` objects

**Step 4: Commit**

```bash
git add packages/api/src/routes/admin.ts packages/api/src/server.ts
git commit -m "feat: add admin dashboard API with KPI stats and alerts"
```

---

### Task 3: Add paginated booking list endpoint to admin router

**Files:**
- Modify: `packages/api/src/routes/admin.ts`

**Step 1: Add the bookings list endpoint**

Append to `packages/api/src/routes/admin.ts` (before the closing of the file):

```typescript
const listSchema = z.object({
  status: z.enum(['all', 'hold', 'paid', 'active', 'overdue', 'completed', 'cancelled']).default('all'),
  date: z.enum(['all', 'today', 'upcoming', 'past']).default('all'),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * GET /api/admin/bookings
 * Paginated, filterable booking list for the admin dashboard.
 */
adminRouter.get('/bookings', async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { status, date, search, page, limit } = parsed.data;
  const offset = (page - 1) * limit;
  const params: any[] = [];
  const conditions: string[] = [];

  // Status filter
  if (status === 'overdue') {
    conditions.push(`r.status = 'active' AND EXISTS (
      SELECT 1 FROM bookings.reservation_items ri
      WHERE ri.reservation_id = r.id
        AND ri.checked_out_at IS NOT NULL
        AND ri.checked_in_at IS NULL
        AND upper(ri.rental_period) < NOW()
    )`);
  } else if (status !== 'all') {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }

  // Date filter
  if (date === 'today') {
    conditions.push(`lower(r.rental_period) >= date_trunc('day', NOW() AT TIME ZONE '${TIMEZONE}')::timestamp AT TIME ZONE '${TIMEZONE}'
      AND lower(r.rental_period) < (date_trunc('day', NOW() AT TIME ZONE '${TIMEZONE}') + INTERVAL '1 day')::timestamp AT TIME ZONE '${TIMEZONE}'`);
  } else if (date === 'upcoming') {
    conditions.push(`lower(r.rental_period) > NOW()`);
  } else if (date === 'past') {
    conditions.push(`upper(r.rental_period) < NOW()`);
  }

  // Search filter (name, phone, email, or booking ID prefix)
  if (search) {
    params.push(`%${search}%`);
    const searchIdx = params.length;
    conditions.push(`(
      c.full_name ILIKE $${searchIdx}
      OR c.email ILIKE $${searchIdx}
      OR c.phone ILIKE $${searchIdx}
      OR r.id::text ILIKE $${searchIdx}
    )`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // Count total matching
    const countResult = await pool.query(
      `SELECT count(*)::int AS total
       FROM bookings.reservations r
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       ${whereClause}`,
      params,
    );
    const total = countResult.rows[0].total;

    // Fetch page
    const dataParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT r.id, r.rental_period, r.duration_type, r.status, r.source,
              r.total_amount, r.deposit_amount, r.created_at, r.hold_expires,
              c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
              -- Bike summary: aggregated from reservation_items
              (SELECT json_agg(json_build_object(
                'id', ri.id,
                'bike_id', ri.bike_id,
                'bike_name', b.name,
                'bike_type', b.type,
                'rental_price', ri.rental_price,
                'deposit_amount', ri.deposit_amount,
                'checked_out_at', ri.checked_out_at,
                'checked_in_at', ri.checked_in_at
              ) ORDER BY ri.created_at)
               FROM bookings.reservation_items ri
               JOIN bikes b ON b.id = ri.bike_id
               WHERE ri.reservation_id = r.id
              ) AS items,
              -- Waiver summary
              (SELECT json_agg(json_build_object(
                'id', w.id,
                'customer_name', wc.full_name,
                'signed_at', w.signed_at,
                'is_minor', w.is_minor
              ))
               FROM bookings.waivers w
               LEFT JOIN bookings.customers wc ON w.customer_id = wc.id
               WHERE w.reservation_id = r.id
              ) AS waivers,
              -- Counts for quick display
              (SELECT count(*) FROM bookings.reservation_items ri2 WHERE ri2.reservation_id = r.id)::int AS item_count,
              (SELECT count(*) FROM bookings.waivers w2 WHERE w2.reservation_id = r.id)::int AS waiver_count
       FROM bookings.reservations r
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       ${whereClause}
       ORDER BY
         CASE WHEN r.status = 'active' AND EXISTS (
           SELECT 1 FROM bookings.reservation_items ri3
           WHERE ri3.reservation_id = r.id AND ri3.checked_in_at IS NULL AND upper(ri3.rental_period) < NOW()
         ) THEN 0 ELSE 1 END,
         r.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );

    res.json({
      bookings: result.rows,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Admin bookings list error:', err);
    res.status(500).json({ error: 'Failed to list bookings' });
  }
});
```

**Step 2: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

Run: `curl -s "http://localhost:3001/api/admin/bookings?status=all&page=1&limit=5" | jq .`
Expected: JSON with `bookings` array, `total`, `page`, `pages`

**Step 3: Commit**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat: add paginated admin bookings list with filters and search"
```

---

### Task 4: Add booking detail endpoint

**Files:**
- Modify: `packages/api/src/routes/admin.ts`

**Step 1: Add the detail endpoint**

Append to admin router:

```typescript
const uuidParam = z.string().uuid();

/**
 * GET /api/admin/bookings/:id
 * Full booking detail with items, waivers, customer, notes, and timeline.
 */
adminRouter.get('/bookings/:id', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT r.id, r.rental_period, r.duration_type, r.status, r.source,
              r.total_amount, r.deposit_amount, r.created_at, r.updated_at,
              r.hold_expires, r.moneris_txn, r.payment_token,
              c.id AS customer_id, c.full_name AS customer_name,
              c.email AS customer_email, c.phone AS customer_phone,
              c.date_of_birth AS customer_dob
       FROM bookings.reservations r
       LEFT JOIN bookings.customers c ON r.customer_id = c.id
       WHERE r.id = $1`,
      [idParsed.data],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const booking = result.rows[0];

    // Items
    const items = await pool.query(
      `SELECT ri.id, ri.bike_id, ri.rental_period, ri.rental_price, ri.deposit_amount,
              ri.checked_out_at, ri.checked_in_at,
              b.name AS bike_name, b.type AS bike_type, b.size AS bike_size
       FROM bookings.reservation_items ri
       JOIN bikes b ON b.id = ri.bike_id
       WHERE ri.reservation_id = $1
       ORDER BY ri.created_at`,
      [idParsed.data],
    );

    // Waivers
    const waivers = await pool.query(
      `SELECT w.id, w.signed_at, w.is_minor, w.guardian_customer_id, w.pdf_storage_key,
              c2.full_name AS signer_name, c2.email AS signer_email, c2.phone AS signer_phone,
              gc.full_name AS guardian_name
       FROM bookings.waivers w
       LEFT JOIN bookings.customers c2 ON w.customer_id = c2.id
       LEFT JOIN bookings.customers gc ON w.guardian_customer_id = gc.id
       WHERE w.reservation_id = $1
       ORDER BY w.signed_at`,
      [idParsed.data],
    );

    // Notes
    const notes = await pool.query(
      `SELECT id, text, created_by, created_at
       FROM bookings.notes
       WHERE reservation_id = $1
       ORDER BY created_at DESC`,
      [idParsed.data],
    );

    // Check if any items are overdue
    const hasOverdue = items.rows.some((item: any) =>
      item.checked_out_at && !item.checked_in_at && new Date(item.rental_period.split(',')[1]) < new Date()
    );

    res.json({
      ...booking,
      is_overdue: hasOverdue,
      items: items.rows,
      waivers: waivers.rows,
      notes: notes.rows,
    });
  } catch (err) {
    console.error('Booking detail error:', err);
    res.status(500).json({ error: 'Failed to fetch booking details' });
  }
});
```

**Step 2: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat: add admin booking detail endpoint with items, waivers, notes"
```

---

### Task 5: Add check-out, check-in, cancel, extend, and notes endpoints

**Files:**
- Modify: `packages/api/src/routes/admin.ts`

**Step 1: Add lifecycle management endpoints**

Append to admin router:

```typescript
/**
 * PATCH /api/admin/bookings/:id/check-out
 * Process bike pickup — marks items as checked out, sets booking to active.
 */
adminRouter.patch('/bookings/:id/check-out', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const { itemIds } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reservation = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [idParsed.data],
    );
    if (reservation.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    if (!['paid', 'active'].includes(reservation.rows[0].status)) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Cannot check out from status: ${reservation.rows[0].status}` });
      return;
    }

    // Check out specific items or all
    let updateQuery: string;
    let updateParams: any[];
    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      updateQuery = `UPDATE bookings.reservation_items
        SET checked_out_at = NOW()
        WHERE reservation_id = $1 AND id = ANY($2) AND checked_out_at IS NULL
        RETURNING id`;
      updateParams = [idParsed.data, itemIds];
    } else {
      updateQuery = `UPDATE bookings.reservation_items
        SET checked_out_at = NOW()
        WHERE reservation_id = $1 AND checked_out_at IS NULL
        RETURNING id`;
      updateParams = [idParsed.data];
    }

    const updated = await client.query(updateQuery, updateParams);

    // Set booking to active
    await client.query(
      `UPDATE bookings.reservations SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [idParsed.data],
    );

    await client.query('COMMIT');
    res.json({ status: 'active', checked_out: updated.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Check-out error:', err);
    res.status(500).json({ error: 'Failed to check out' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/admin/bookings/:id/check-in
 * Process bike return — marks items as checked in.
 * If all items checked in, sets booking to completed.
 */
adminRouter.patch('/bookings/:id/check-in', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const { itemIds, notes } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reservation = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [idParsed.data],
    );
    if (reservation.rowCount === 0 || reservation.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Booking not found or not active' });
      return;
    }

    // Check in specific items or all
    let updateQuery: string;
    let updateParams: any[];
    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      updateQuery = `UPDATE bookings.reservation_items
        SET checked_in_at = NOW()
        WHERE reservation_id = $1 AND id = ANY($2) AND checked_in_at IS NULL AND checked_out_at IS NOT NULL
        RETURNING id`;
      updateParams = [idParsed.data, itemIds];
    } else {
      updateQuery = `UPDATE bookings.reservation_items
        SET checked_in_at = NOW()
        WHERE reservation_id = $1 AND checked_in_at IS NULL AND checked_out_at IS NOT NULL
        RETURNING id`;
      updateParams = [idParsed.data];
    }

    const updated = await client.query(updateQuery, updateParams);

    // Add note if provided
    if (notes) {
      await client.query(
        `INSERT INTO bookings.notes (reservation_id, text) VALUES ($1, $2)`,
        [idParsed.data, notes],
      );
    }

    // Check if ALL items are now checked in → complete the booking
    const remaining = await client.query(
      `SELECT count(*)::int AS remaining
       FROM bookings.reservation_items
       WHERE reservation_id = $1 AND checked_out_at IS NOT NULL AND checked_in_at IS NULL`,
      [idParsed.data],
    );

    const allReturned = remaining.rows[0].remaining === 0;
    if (allReturned) {
      await client.query(
        `UPDATE bookings.reservations SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [idParsed.data],
      );
    } else {
      await client.query(
        `UPDATE bookings.reservations SET updated_at = NOW() WHERE id = $1`,
        [idParsed.data],
      );
    }

    await client.query('COMMIT');
    res.json({
      status: allReturned ? 'completed' : 'active',
      checked_in: updated.rowCount,
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

/**
 * PATCH /api/admin/bookings/:id/cancel
 * Cancel a booking with a reason.
 */
adminRouter.patch('/bookings/:id/cancel', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const { reason } = req.body || {};

  try {
    const result = await pool.query(
      `UPDATE bookings.reservations SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status IN ('hold', 'paid')
       RETURNING id`,
      [idParsed.data],
    );

    if (result.rowCount === 0) {
      res.status(400).json({ error: 'Booking not found or cannot be cancelled from current status' });
      return;
    }

    // Add cancellation note
    if (reason) {
      await pool.query(
        `INSERT INTO bookings.notes (reservation_id, text) VALUES ($1, $2)`,
        [idParsed.data, `Cancelled: ${reason}`],
      );
    }

    res.json({ status: 'cancelled' });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

/**
 * PATCH /api/admin/bookings/:id/extend
 * Extend the rental period for an active booking.
 * Joe decides manually — no automatic charges.
 */
adminRouter.patch('/bookings/:id/extend', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const { newReturnTime } = req.body || {};
  if (!newReturnTime) {
    res.status(400).json({ error: 'newReturnTime is required (ISO timestamp)' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reservation = await client.query(
      `SELECT id, rental_period FROM bookings.reservations WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [idParsed.data],
    );
    if (reservation.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Booking not found or not active' });
      return;
    }

    // Update reservation rental_period upper bound
    await client.query(
      `UPDATE bookings.reservations
       SET rental_period = tstzrange(lower(rental_period), $2::timestamptz, '[)'),
           updated_at = NOW()
       WHERE id = $1`,
      [idParsed.data, newReturnTime],
    );

    // Update all items' rental_period to match
    await client.query(
      `UPDATE bookings.reservation_items
       SET rental_period = tstzrange(lower(rental_period), $2::timestamptz, '[)')
       WHERE reservation_id = $1 AND checked_in_at IS NULL`,
      [idParsed.data, newReturnTime],
    );

    // Add note
    await client.query(
      `INSERT INTO bookings.notes (reservation_id, text) VALUES ($1, $2)`,
      [idParsed.data, `Rental extended to ${newReturnTime}`],
    );

    await client.query('COMMIT');
    res.json({ status: 'extended', new_return_time: newReturnTime });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23P01') {
      res.status(409).json({ error: 'Extension conflicts with another booking for one or more bikes' });
      return;
    }
    console.error('Extend error:', err);
    res.status(500).json({ error: 'Failed to extend rental' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/bookings/:id/note
 * Add a note to a booking.
 */
adminRouter.post('/bookings/:id/note', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    res.status(400).json({ error: 'Note text is required' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO bookings.notes (reservation_id, text) VALUES ($1, $2) RETURNING id, created_at`,
      [idParsed.data, text.trim()],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add note error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});
```

**Step 2: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat: add admin check-out, check-in, cancel, extend, and notes endpoints"
```

---

### Task 6: Add walk-in booking endpoint

**Files:**
- Modify: `packages/api/src/routes/admin.ts`

**Step 1: Add walk-in endpoint**

Append to admin router:

```typescript
const walkInSchema = z.object({
  bikes: z.array(z.object({
    bikeId: z.number().int().positive(),
  })).min(1).max(10),
  duration: z.enum(['2h', '4h', '8h']),
  customer: z.object({
    fullName: z.string().min(2).max(200).trim(),
    phone: z.string().min(7).max(20),
    email: z.string().email().max(254).optional(),
  }),
});

const DURATION_HOURS: Record<string, number> = { '2h': 2, '4h': 4 };

/**
 * POST /api/admin/walk-in
 * Create a walk-in booking. Start time = now. No hold, no online payment.
 * Goes directly to 'active' status after creation.
 */
adminRouter.post('/walk-in', async (req, res) => {
  const parsed = walkInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { bikes, duration, customer } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Calculate rental period: now → now + duration
    const now = new Date();
    let rangeEnd: Date;
    if (duration === '8h') {
      // Full Day: ends at 6 PM today
      rangeEnd = new Date(now);
      rangeEnd.setHours(18, 0, 0, 0);
      // If it's already past 6 PM, extend to tomorrow 6 PM
      if (rangeEnd <= now) {
        rangeEnd.setDate(rangeEnd.getDate() + 1);
      }
    } else {
      const hours = DURATION_HOURS[duration];
      rangeEnd = new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    // Create or find customer
    const customerResult = await client.query(
      `INSERT INTO bookings.customers (full_name, phone, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone
       RETURNING id`,
      [customer.fullName, customer.phone, customer.email || `walkin-${Date.now()}@joes-garage.ca`],
    );
    const customerId = customerResult.rows[0].id;

    // Fetch bike prices
    const PRICE_COL: Record<string, string> = { '2h': 'price2h', '4h': 'price4h', '8h': 'price8h' };
    const priceCol = PRICE_COL[duration];
    const bikeIds = bikes.map(b => b.bikeId);
    const bikeData = await client.query(
      `SELECT id, ${priceCol} AS rental_price, deposit_amount FROM bikes WHERE id = ANY($1) AND status = 'available'`,
      [bikeIds],
    );

    if (bikeData.rowCount !== bikes.length) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'One or more bikes not available' });
      return;
    }

    // Calculate totals
    let totalRental = 0;
    let totalDeposit = 0;
    for (const bike of bikeData.rows) {
      totalRental += parseFloat(bike.rental_price);
      totalDeposit += parseFloat(bike.deposit_amount);
    }

    // Create reservation
    const reservation = await client.query(
      `INSERT INTO bookings.reservations
        (customer_id, rental_period, duration_type, status, source, total_amount, deposit_amount)
       VALUES ($1, tstzrange($2, $3, '[)'), $4, 'active', 'walk-in', $5, $6)
       RETURNING id`,
      [customerId, now.toISOString(), rangeEnd.toISOString(), duration, totalRental + totalDeposit, totalDeposit],
    );
    const reservationId = reservation.rows[0].id;

    // Create reservation items (one per bike)
    for (const bike of bikeData.rows) {
      await client.query(
        `INSERT INTO bookings.reservation_items
          (reservation_id, bike_id, rental_period, rental_price, deposit_amount, checked_out_at)
         VALUES ($1, $2, tstzrange($3, $4, '[)'), $5, $6, NOW())`,
        [reservationId, bike.id, now.toISOString(), rangeEnd.toISOString(),
         bike.rental_price, bike.deposit_amount],
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      reservationId,
      status: 'active',
      waiverUrl: `/waiver/${reservationId}`,
      totalAmount: totalRental + totalDeposit,
      returnTime: rangeEnd.toISOString(),
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23P01') {
      res.status(409).json({ error: 'One or more bikes already booked for this time' });
      return;
    }
    console.error('Walk-in error:', err);
    res.status(500).json({ error: 'Failed to create walk-in booking' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/admin/fleet
 * Fleet status breakdown by bike type.
 */
adminRouter.get('/fleet', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.type,
        count(*)::int AS total,
        count(*) FILTER (WHERE b.status = 'available'
          AND b.id NOT IN (
            SELECT ri.bike_id FROM bookings.reservation_items ri
            JOIN bookings.reservations r ON r.id = ri.reservation_id
            WHERE r.status = 'active' AND ri.checked_out_at IS NOT NULL AND ri.checked_in_at IS NULL
          ))::int AS available,
        count(*) FILTER (WHERE b.id IN (
          SELECT ri.bike_id FROM bookings.reservation_items ri
          JOIN bookings.reservations r ON r.id = ri.reservation_id
          WHERE r.status = 'active' AND ri.checked_out_at IS NOT NULL AND ri.checked_in_at IS NULL
        ))::int AS rented_out,
        count(*) FILTER (WHERE b.id IN (
          SELECT ri.bike_id FROM bookings.reservation_items ri
          JOIN bookings.reservations r ON r.id = ri.reservation_id
          WHERE r.status IN ('paid') AND lower(ri.rental_period) > NOW()
        ))::int AS reserved,
        count(*) FILTER (WHERE b.status = 'maintenance')::int AS maintenance
      FROM bikes b
      WHERE b.status != 'retired'
      GROUP BY b.type
      ORDER BY b.type
    `);

    res.json({ fleet: result.rows });
  } catch (err) {
    console.error('Fleet status error:', err);
    res.status(500).json({ error: 'Failed to fetch fleet status' });
  }
});
```

**Step 2: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

Run: `curl -s http://localhost:3001/api/admin/fleet | jq .`
Expected: JSON with fleet array showing bike types and counts

**Step 3: Commit**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat: add walk-in booking and fleet status admin endpoints"
```

---

## Batch 3: Multi-Bike Hold & Waiver Updates

### Task 7: Update hold endpoint for multi-bike bookings

**Files:**
- Modify: `packages/api/src/routes/bookings.ts`

**Step 1: Update the hold schema and endpoint**

Replace the `holdSchema` with a new version that accepts an array of bikes:

```typescript
const holdSchema = z
  .object({
    bikes: z.array(z.object({
      bikeId: z.number().int().positive(),
    })).min(1).max(10),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    duration: z.enum(['2h', '4h', '8h', 'multi-day']),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  // ... keep existing refine validators
```

Replace the `POST /hold` handler to:
1. Accept `bikes` array instead of single `bikeId`
2. Create one reservation + multiple reservation_items
3. Calculate total across all bikes
4. Return the reservation ID (one hold timer for the whole group)

The full replacement is detailed in the design doc. Key changes:
- Loop through `bikes` array, fetch each bike's price
- Sum rental + deposit across all bikes
- INSERT one reservation, then INSERT N reservation_items
- The EXCLUDE constraint on `reservation_items` prevents double-booking per bike

**Step 2: Also keep backward compatibility**

Accept both the old `{ bikeId }` format and the new `{ bikes: [{ bikeId }] }` format. If the old format is received, convert it to the new format internally:

```typescript
// Backward compat: convert { bikeId: 5 } → { bikes: [{ bikeId: 5 }] }
if (req.body.bikeId && !req.body.bikes) {
  req.body.bikes = [{ bikeId: req.body.bikeId }];
}
```

**Step 3: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/api/src/routes/bookings.ts
git commit -m "feat: update hold endpoint for multi-bike bookings"
```

---

### Task 8: Update waiver endpoint for multi-rider support

**Files:**
- Modify: `packages/api/src/routes/waivers.ts`

**Step 1: Update the waiver schema and endpoint**

Key changes:
- Remove the "one waiver per reservation" uniqueness check — now multiple waivers per reservation are allowed (one per rider)
- Add `isMinor` boolean field (optional, defaults to false)
- Add `guardianName` string field (required if isMinor is true)
- When `isMinor` is true, look up guardian by name from existing customers in the booking
- Change the waiver PDF storage key from `waivers/${reservationId}.pdf` to `waivers/${reservationId}-${customerId}.pdf`

**Step 2: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/api/src/routes/waivers.ts
git commit -m "feat: update waiver endpoint for multi-rider support with minor/guardian"
```

---

### Task 9: Update pay endpoint and confirmation for multi-bike

**Files:**
- Modify: `packages/api/src/routes/bookings.ts`

**Step 1: Update pay endpoint**

Change the `POST /pay` handler to:
- Join against `reservation_items` instead of single `bike_id`
- Email confirmation includes all bikes in the booking
- Confirmation number remains the same

**Step 2: Update GET /:id (public confirmation)**

Change to return items array instead of single bike:

```typescript
// Replace the single bike join with items subquery
const items = await pool.query(
  `SELECT ri.rental_price, ri.deposit_amount, b.name AS bike_name, b.type AS bike_type
   FROM bookings.reservation_items ri
   JOIN bikes b ON b.id = ri.bike_id
   WHERE ri.reservation_id = $1`,
  [idParsed.data],
);
```

**Step 3: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/api/src/routes/bookings.ts
git commit -m "feat: update pay and confirmation endpoints for multi-bike bookings"
```

---

### Task 10: Update email templates for multi-bike

**Files:**
- Modify: `packages/api/src/services/email.ts`

**Step 1: Update BookingDetails interface and templates**

Change `bikeName` and `bikeType` to an `items` array:

```typescript
interface BookingItem {
  bikeName: string;
  bikeType: string;
  rentalPrice: string;
  depositAmount: string;
}

interface BookingDetails {
  // ... existing fields
  items: BookingItem[];  // replaces bikeName/bikeType
}
```

Update the email HTML template to render a table of bikes instead of a single row.

**Step 2: Build and test**

Run: `cd packages/api && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/api/src/services/email.ts packages/api/src/routes/bookings.ts
git commit -m "feat: update email templates for multi-bike bookings"
```

---

## Batch 4: Payload CMS Dashboard Components

### Task 11: Create nav link and register the custom view

**Files:**
- Create: `packages/cms/src/components/nav/BookingsNavLink.tsx`
- Modify: `packages/cms/src/payload.config.ts`

**Step 1: Create nav link component**

```tsx
'use client'
import React from 'react'
import { NavLink } from '@payloadcms/ui'

export const BookingsNavLink: React.FC = () => {
  return (
    <NavLink href="/admin/bookings" label="Bookings" />
  )
}
```

> **Note:** The exact import path for `NavLink` may need verification. If `NavLink` isn't exported from `@payloadcms/ui`, use a simple `<a>` tag styled to match Payload's nav items. Check `@payloadcms/ui` exports first.

**Step 2: Register in payload.config.ts**

Add to `admin.components`:

```typescript
components: {
  // ... existing graphics, beforeLogin, providers
  afterNavLinks: ['/src/components/nav/BookingsNavLink#BookingsNavLink'],
  views: {
    bookings: {
      Component: '/src/components/views/Bookings/index#BookingsView',
      path: '/bookings',
      exact: true,
    },
  },
},
```

**Step 3: Commit**

```bash
git add packages/cms/src/components/nav/BookingsNavLink.tsx packages/cms/src/payload.config.ts
git commit -m "feat: register bookings dashboard view and nav link in Payload config"
```

---

### Task 12: Create server component wrapper

**Files:**
- Create: `packages/cms/src/components/views/Bookings/index.tsx`

**Step 1: Create server component**

```tsx
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { BookingsClient } from './BookingsClient'

export const BookingsView: React.FC<AdminViewServerProps> = ({
  initPageResult,
  params,
  searchParams,
}) => {
  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={initPageResult.req.user}
      visibleEntities={initPageResult.visibleEntities}
    >
      <BookingsClient
        apiUrl={process.env.EXPRESS_API_URL || 'http://localhost:3001'}
      />
    </DefaultTemplate>
  )
}
```

> **Note:** The exact props for `DefaultTemplate` may vary by Payload version. If it throws, check `@payloadcms/next/templates` exports. The `Gutter` component from `@payloadcms/ui` can be used for padding if needed.

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/index.tsx
git commit -m "feat: create bookings dashboard server component"
```

---

### Task 13: Create main client component with data fetching

**Files:**
- Create: `packages/cms/src/components/views/Bookings/BookingsClient.tsx`
- Create: `packages/cms/src/components/views/Bookings/useBookings.ts`

**Step 1: Create custom hook for data fetching with polling**

`useBookings.ts`:
```tsx
'use client'
import { useState, useEffect, useCallback } from 'react'

const POLL_INTERVAL = 30_000 // 30 seconds

interface DashboardStats {
  active_rentals: number
  returns_due_today: number
  overdue_count: number
  available_fleet: number
  total_fleet: number
}

interface Booking {
  id: string
  rental_period: string
  duration_type: string
  status: string
  source: string
  total_amount: string
  deposit_amount: string
  customer_name: string
  customer_email: string
  customer_phone: string
  items: any[]
  waivers: any[]
  item_count: number
  waiver_count: number
  created_at: string
}

interface DashboardData {
  stats: DashboardStats
  alerts: { overdue: any[]; unsigned_waivers: any[] }
}

interface BookingsListData {
  bookings: Booking[]
  total: number
  page: number
  pages: number
}

export function useBookings(apiUrl: string) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [bookingsList, setBookingsList] = useState<BookingsListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ status: 'all', date: 'all', search: '', page: 1 })

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/dashboard`)
      if (!res.ok) throw new Error('Failed to load dashboard')
      const data = await res.json()
      setDashboard(data)
    } catch (err: any) {
      console.error('Dashboard fetch error:', err)
    }
  }, [apiUrl])

  const fetchBookings = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        status: filters.status,
        date: filters.date,
        page: String(filters.page),
        limit: '25',
      })
      if (filters.search) params.set('search', filters.search)

      const res = await fetch(`${apiUrl}/api/admin/bookings?${params}`)
      if (!res.ok) throw new Error('Failed to load bookings')
      const data = await res.json()
      setBookingsList(data)
    } catch (err: any) {
      setError(err.message)
    }
  }, [apiUrl, filters])

  const refresh = useCallback(async () => {
    await Promise.all([fetchDashboard(), fetchBookings()])
  }, [fetchDashboard, fetchBookings])

  // Initial load
  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // Polling
  useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [refresh])

  return {
    dashboard,
    bookingsList,
    loading,
    error,
    filters,
    setFilters,
    refresh,
  }
}
```

**Step 2: Create main client component shell**

`BookingsClient.tsx`:
```tsx
'use client'
import React, { useState } from 'react'
import { useBookings } from './useBookings'
import { KPICards } from './KPICards'
import { AlertBar } from './AlertBar'
import { BookingTable } from './BookingTable'
import { BookingDetail } from './BookingDetail'
import { WalkInModal } from './WalkInModal'
import { FleetStatus } from './FleetStatus'

import './bookings.scss'

interface Props {
  apiUrl: string
}

export const BookingsClient: React.FC<Props> = ({ apiUrl }) => {
  const { dashboard, bookingsList, loading, error, filters, setFilters, refresh } = useBookings(apiUrl)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [showFleet, setShowFleet] = useState(false)

  return (
    <div className="bookings-dashboard">
      {/* Header */}
      <div className="bookings-dashboard__header">
        <h1>Bookings</h1>
        <div className="bookings-dashboard__actions">
          <button
            className="bookings-dashboard__fleet-toggle"
            onClick={() => setShowFleet(!showFleet)}
          >
            Fleet Status
          </button>
          <button
            className="bookings-dashboard__walk-in-btn"
            onClick={() => setShowWalkIn(true)}
          >
            + New Walk-in
          </button>
        </div>
      </div>

      {error && <div className="bookings-dashboard__error">{error}</div>}

      {/* Zone 1: KPI Cards */}
      {dashboard && <KPICards stats={dashboard.stats} />}

      {/* Fleet Status (collapsible) */}
      {showFleet && <FleetStatus apiUrl={apiUrl} />}

      {/* Zone 2: Alert Bar */}
      {dashboard && <AlertBar alerts={dashboard.alerts} onSelect={setSelectedBookingId} />}

      {/* Zone 3: Booking Table */}
      <div className="bookings-dashboard__main">
        <div className={`bookings-dashboard__table-area ${selectedBookingId ? 'bookings-dashboard__table-area--with-panel' : ''}`}>
          <BookingTable
            bookings={bookingsList?.bookings || []}
            total={bookingsList?.total || 0}
            page={bookingsList?.page || 1}
            pages={bookingsList?.pages || 1}
            loading={loading}
            filters={filters}
            onFilterChange={setFilters}
            onSelect={setSelectedBookingId}
            selectedId={selectedBookingId}
          />
        </div>

        {/* Zone 4: Slide-out Detail Panel */}
        {selectedBookingId && (
          <BookingDetail
            bookingId={selectedBookingId}
            apiUrl={apiUrl}
            onClose={() => setSelectedBookingId(null)}
            onAction={refresh}
          />
        )}
      </div>

      {/* Walk-in Modal */}
      {showWalkIn && (
        <WalkInModal
          apiUrl={apiUrl}
          onClose={() => setShowWalkIn(false)}
          onComplete={() => { setShowWalkIn(false); refresh(); }}
        />
      )}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add packages/cms/src/components/views/Bookings/BookingsClient.tsx packages/cms/src/components/views/Bookings/useBookings.ts
git commit -m "feat: create bookings dashboard client component with data fetching hook"
```

---

### Task 14: Create KPI Cards component

**Files:**
- Create: `packages/cms/src/components/views/Bookings/KPICards.tsx`

**Step 1: Create the component**

```tsx
'use client'
import React from 'react'

interface Stats {
  active_rentals: number
  returns_due_today: number
  overdue_count: number
  available_fleet: number
  total_fleet: number
}

export const KPICards: React.FC<{ stats: Stats }> = ({ stats }) => {
  const cards = [
    { label: 'Active Rentals', value: stats.active_rentals, color: '#10B981' },
    { label: 'Returns Due Today', value: stats.returns_due_today, color: '#3B82F6' },
    { label: 'Overdue', value: stats.overdue_count, color: stats.overdue_count > 0 ? '#EF4444' : '#9CA3AF' },
    { label: 'Available Fleet', value: `${stats.available_fleet}/${stats.total_fleet}`, color: '#6B7280' },
  ]

  return (
    <div className="kpi-cards">
      {cards.map((card) => (
        <div key={card.label} className="kpi-card" style={{ '--card-color': card.color } as React.CSSProperties}>
          <span className="kpi-card__value">{card.value}</span>
          <span className="kpi-card__label">{card.label}</span>
        </div>
      ))}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/KPICards.tsx
git commit -m "feat: create KPI cards component for bookings dashboard"
```

---

### Task 15: Create AlertBar component

**Files:**
- Create: `packages/cms/src/components/views/Bookings/AlertBar.tsx`

**Step 1: Create the component**

AlertBar renders overdue and unsigned waiver alerts. Each alert is clickable and selects the booking in the detail panel. Collapses to nothing when empty.

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/AlertBar.tsx
git commit -m "feat: create alert bar component for overdue and waiver warnings"
```

---

### Task 16: Create StatusBadge component

**Files:**
- Create: `packages/cms/src/components/views/Bookings/StatusBadge.tsx`

**Step 1: Create the component**

Reusable status pill with color coding:
- hold → gray
- paid → blue
- active → green
- overdue → red
- completed → muted
- cancelled → strikethrough

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/StatusBadge.tsx
git commit -m "feat: create status badge component with color coding"
```

---

### Task 17: Create BookingTable component

**Files:**
- Create: `packages/cms/src/components/views/Bookings/BookingTable.tsx`

**Step 1: Create the component**

Full filterable, paginated table with:
- Search bar (name, phone, email, booking ID)
- Filter chips (All | Today | Upcoming | Active | Overdue | Completed)
- Table columns: Status, Customer, Bikes, Duration, Pickup, Return, Waivers, Actions
- Row click opens detail panel
- Pagination controls
- Loading skeleton state

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/BookingTable.tsx
git commit -m "feat: create booking table component with filters, search, and pagination"
```

---

### Task 18: Create BookingDetail slide-out panel

**Files:**
- Create: `packages/cms/src/components/views/Bookings/BookingDetail.tsx`

**Step 1: Create the component**

Slide-out panel (400px from right) with:
- Header: booking ref, status, source
- Customer section: name, phone, email
- Items table: per-bike status, price, check-in/out times
- Waivers checklist: signed/pending per rider
- Notes/timeline
- Context-sensitive action buttons (check-out, check-in, extend, cancel, add note)
- Each action calls the admin API, then triggers refresh

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/BookingDetail.tsx
git commit -m "feat: create booking detail slide-out panel with lifecycle actions"
```

---

### Task 19: Create WalkInModal component

**Files:**
- Create: `packages/cms/src/components/views/Bookings/WalkInModal.tsx`

**Step 1: Create the component**

Modal overlay with 3-step walk-in flow:
1. Pick bikes (grid of available types with +/- quantity) + duration chips
2. Customer info (name, phone, email optional)
3. Confirmation + QR code for waiver

Calls `POST /api/admin/walk-in`, then shows the waiver QR URL.

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/WalkInModal.tsx
git commit -m "feat: create walk-in modal for quick counter bookings"
```

---

### Task 20: Create FleetStatus widget

**Files:**
- Create: `packages/cms/src/components/views/Bookings/FleetStatus.tsx`

**Step 1: Create the component**

Collapsible panel showing horizontal stacked bars per bike type.
Fetches from `GET /api/admin/fleet`.
Colors: green=available, blue=reserved, teal=rented, gray=maintenance.

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/FleetStatus.tsx
git commit -m "feat: create fleet status widget with availability bars"
```

---

### Task 21: Add dashboard styles

**Files:**
- Create: `packages/cms/src/components/views/Bookings/bookings.scss`

**Step 1: Create styles**

Style the entire dashboard using Payload CSS variables for consistency with the admin theme. Key styles:
- `.bookings-dashboard` — full-width layout
- `.kpi-cards` — 4-column grid (responsive to 2-col on mobile)
- `.alert-bar` — red/amber strips with dismiss
- `.booking-table` — full-width table with hover states
- `.booking-detail` — fixed right panel, 400px wide, with overlay
- `.walk-in-modal` — centered modal with backdrop
- `.fleet-status` — horizontal bars with color segments
- `.status-badge` — small colored pills

Use `var(--theme-elevation-50)`, `var(--theme-elevation-100)`, etc. for backgrounds.
Use `var(--theme-text)` for text colors.
Use the Joe's Garage red `#D42B2B` sparingly for primary actions.

**Step 2: Commit**

```bash
git add packages/cms/src/components/views/Bookings/bookings.scss
git commit -m "feat: add bookings dashboard styles"
```

---

### Task 22: Verify dashboard loads in Payload CMS

**Step 1: Start CMS**

Run: `cd packages/cms && npm run dev`

**Step 2: Navigate to bookings**

Open `http://localhost:3003/admin/bookings` in browser.
Expected: Dashboard renders with KPI cards, empty table (or existing bookings), and nav link in sidebar.

**Step 3: Fix any issues**

Common issues:
- Import paths: Payload resolves components relative to `tsconfig.json` paths. If a component isn't found, check the path string in `payload.config.ts` matches the actual file location.
- `DefaultTemplate` props: May vary by Payload version. Check `@payloadcms/next/templates` types.
- SCSS import: The `import './bookings.scss'` in the client component should work since Payload uses Next.js which handles SCSS imports.
- CORS: Ensure the CMS origin (`http://localhost:3003`) is in the Express API's allowed origins.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve dashboard integration issues"
```

---

## Batch 5: Frontend Multi-Bike Booking Flow

### Task 23: Update Alpine.js for multi-bike cart

**Files:**
- Modify: `packages/frontend/src/alpine.ts`

**Step 1: Replace single-bike selection with cart**

Key changes to `bookingFlow`:
- Replace `selectedBike` with `cart: [] as { bike: any; quantity: number }[]`
- Add `addToCart(bike)`, `removeFromCart(bikeId)`, `updateQuantity(bikeId, delta)` methods
- Update `rentalPrice` to sum across all cart items
- Update `totalAmount` to sum rental + deposits across all items
- Update `selectAndHoldBike` → `holdCart()` — sends `{ bikes: [{bikeId}, ...] }` to the hold endpoint
- Add `cartItemCount` computed for the summary bar
- Keep backward compat: single bike selection still works (cart of 1)

**Step 2: Build frontend**

Run: `cd packages/frontend && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/alpine.ts
git commit -m "feat: update booking flow for multi-bike cart selection"
```

---

### Task 24: Update booking page template for multi-bike

**Files:**
- Modify: `packages/frontend/src/pages/book/index.astro`

**Step 1: Redesign Step 2 for quantity selectors**

Replace one-click bike cards with quantity-controlled cards:
- Each card: photo, name, type, price, "+/−" buttons, quantity display
- Sticky summary bar at bottom: items, subtotal, deposits, rider count, "Continue" button
- "Continue" creates holds on all selected bikes

**Step 2: Redesign Step 3 for multi-rider waivers**

- Show rider count based on cart total
- For each rider: name, email, phone, DOB, signature
- QR code display: "Other riders can scan this to sign on their phone"
- Progress indicator: "Waiver X of Y"
- Minor detection: DOB under 18 shows guardian field

**Step 3: Update Step 4 for multi-bike summary**

Show all bikes with individual prices + deposits, then total.

**Step 4: Build and test**

Run: `cd packages/frontend && npm run dev`
Test the full flow in browser.

**Step 5: Commit**

```bash
git add packages/frontend/src/pages/book/index.astro
git commit -m "feat: update booking page for multi-bike cart and multi-rider waivers"
```

---

### Task 25: Create QR waiver page

**Files:**
- Create: `packages/frontend/src/pages/waiver/[ref].astro`

**Step 1: Create the page**

Astro page at `/waiver/:ref` that:
1. Fetches booking details from `GET /api/bookings/:ref`
2. Shows which riders have signed and which haven't
3. Provides a form for the current rider: name, email, phone, DOB, signature pad
4. Submits to `POST /api/waivers`
5. Shows success confirmation
6. Auto-refreshes to show updated waiver status

No authentication required — the booking reference in the URL is the auth token.

**Step 2: Build and test**

Create a test booking, then visit `/waiver/{reservationId}`.
Expected: Waiver form loads, can sign and submit.

**Step 3: Commit**

```bash
git add packages/frontend/src/pages/waiver/
git commit -m "feat: create QR waiver signing page for walk-ins and group bookings"
```

---

### Task 26: Update confirmation page for multi-bike

**Files:**
- Modify: `packages/frontend/src/pages/book/confirmation.astro` (if it exists) or the confirmation logic in `alpine.ts`

**Step 1: Update to show multiple bikes**

Change from single bike display to a list of all bikes in the booking.
Show waiver status per rider.

**Step 2: Commit**

```bash
git add packages/frontend/src/pages/book/
git commit -m "feat: update confirmation page for multi-bike bookings"
```

---

## Batch 6: Integration Testing & Polish

### Task 27: End-to-end integration test

**Step 1: Test website booking flow (multi-bike)**

1. Open `http://localhost:4321/book`
2. Pick a date, select "4 Hours", pick a time slot
3. Add 2× City Cruiser + 1× Kids Bike
4. Click "Continue" — verify hold created
5. Fill out waiver for rider 1
6. Open QR URL in another tab — fill waiver for rider 2
7. Verify Step 4 shows all bikes, all prices, all deposits
8. Complete payment

**Step 2: Test admin dashboard**

1. Open `http://localhost:3003/admin/bookings`
2. Verify the booking from Step 1 appears in the table
3. Click it — verify detail panel shows all bikes, waivers, customer info
4. Test check-out action
5. Verify KPI cards update (active rentals should increment)
6. Test check-in action on one bike
7. Test check-in on remaining bikes — verify booking completes

**Step 3: Test walk-in flow**

1. Click "New Walk-in"
2. Select bikes, duration, enter customer info
3. Verify booking created with "walk-in" source
4. Verify QR waiver URL works
5. Sign waiver via QR page
6. Verify dashboard shows waiver as signed

**Step 4: Test overdue handling**

1. Create a test booking with a return time in the past (via direct SQL)
2. Verify dashboard shows overdue alert
3. Verify KPI overdue counter is non-zero
4. Test extend action — verify alert clears

### Task 28: Final cleanup and commit

**Step 1: Update hold cleanup cron**

In `packages/api/src/server.ts`, update the hold cleanup cron to also clean up reservation_items for cancelled holds:

```typescript
// After cancelling holds, the ON DELETE CASCADE on reservation_items handles cleanup
```

Actually, `ON DELETE CASCADE` isn't set for cancellation (only deletion). The cron just sets `status = 'cancelled'`, which is fine — the items remain but the EXCLUDE constraint ignores cancelled bookings.

**Step 2: Verify no console errors in browser**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete booking dashboard and multi-bike booking system"
```

---

## File Summary

| File | Action | Batch |
|------|--------|-------|
| `packages/api/src/db/migrations/003_multi_bike_bookings.sql` | CREATE | 1 |
| `packages/api/src/routes/admin.ts` | CREATE | 2 |
| `packages/api/src/server.ts` | MODIFY | 2 |
| `packages/api/src/routes/bookings.ts` | MODIFY | 3 |
| `packages/api/src/routes/waivers.ts` | MODIFY | 3 |
| `packages/api/src/services/email.ts` | MODIFY | 3 |
| `packages/cms/src/payload.config.ts` | MODIFY | 4 |
| `packages/cms/src/components/nav/BookingsNavLink.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/index.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/BookingsClient.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/useBookings.ts` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/KPICards.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/AlertBar.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/StatusBadge.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/BookingTable.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/BookingDetail.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/WalkInModal.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/FleetStatus.tsx` | CREATE | 4 |
| `packages/cms/src/components/views/Bookings/bookings.scss` | CREATE | 4 |
| `packages/frontend/src/alpine.ts` | MODIFY | 5 |
| `packages/frontend/src/pages/book/index.astro` | MODIFY | 5 |
| `packages/frontend/src/pages/waiver/[ref].astro` | CREATE | 5 |
| `packages/frontend/src/pages/book/confirmation.astro` | MODIFY | 5 |

**Total: 23 files (15 new, 8 modified)**
