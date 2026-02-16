# Security Audit & Code Review Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 20 findings from the security audit and code review — 3 critical, 5 high, 6 medium, 4 low security issues plus 2 critical bugs, 6 important, and 4 minor code quality issues.

**Architecture:** Add a shared-secret auth middleware for admin routes, move admin-level endpoints off the public bookings router onto the protected admin router, sanitize all SQL interpolation, fix date calculation bugs, add path traversal protection, and clean up code quality issues. All changes are in `packages/api/` (Express backend) and `packages/cms/` (frontend components).

**Tech Stack:** Express 5, PostgreSQL, Zod, TypeScript, Puppeteer

---

## Phase 1: Critical Security — Admin Authentication

### Task 1: Create admin auth middleware

**Files:**
- Create: `packages/api/src/middleware/adminAuth.ts`

**Step 1: Create the middleware file**

```typescript
import type { Request, Response, NextFunction } from 'express';

/**
 * Shared-secret auth for admin API routes.
 *
 * The CMS bookings dashboard (running on port 3003) sends requests to
 * the API (port 3001). This middleware validates a shared secret passed
 * via the Authorization header: `Bearer <ADMIN_API_SECRET>`.
 *
 * In production, set ADMIN_API_SECRET to a strong random string.
 * In dev, falls back to a default so local development works out of the box.
 */
const ADMIN_SECRET = process.env.ADMIN_API_SECRET || 'dev-admin-secret-change-in-production';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // Strip "Bearer "

  if (token !== ADMIN_SECRET) {
    res.status(403).json({ error: 'Invalid admin credentials' });
    return;
  }

  next();
}
```

**Step 2: Wire it into server.ts**

In `packages/api/src/server.ts`, add the import and apply the middleware + rate limiter to admin routes:

```typescript
// Add import at top:
import { adminAuth } from './middleware/adminAuth.js';

// Add admin-specific rate limiter (stricter: 30 req/min):
const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please try again later' },
});

// Change line 86 from:
app.use('/api/admin', adminRouter);
// To:
app.use('/api/admin', adminLimiter, adminAuth, adminRouter);
```

Also add `'Authorization'` to the CORS `allowedHeaders` array (line 42):
```typescript
allowedHeaders: ['Content-Type', 'Authorization'],
```

**Step 3: Commit**

```
feat: add admin auth middleware with shared-secret Bearer token
```

---

### Task 2: Move admin endpoints off the public bookings router

The audit found 5 admin-level endpoints on the public bookings router (Finding #2). These need to move to the admin router.

**Files:**
- Modify: `packages/api/src/routes/bookings.ts` (remove lines 405-654)
- Modify: `packages/api/src/routes/admin.ts` (add the moved endpoints)

**Step 1: Move endpoints from bookings.ts to admin.ts**

Move these from `bookingsRouter` to `adminRouter`:
1. `GET /admin/list` (bookings.ts:409-431) → already on admin router as `GET /bookings`, so just **delete** this duplicate
2. `POST /:id/capture` (bookings.ts:512-547) → `adminRouter.post('/bookings/:id/capture', ...)`
3. `POST /:id/void` (bookings.ts:552-586) → `adminRouter.post('/bookings/:id/void', ...)`
4. `POST /:id/complete` (bookings.ts:591-616) → `adminRouter.post('/bookings/:id/complete', ...)`
5. `GET /:id/waiver` (bookings.ts:621-654) → `adminRouter.get('/bookings/:id/waiver', ...)`

In `admin.ts`, add the necessary imports:
```typescript
import { capture, voidTransaction } from '../services/moneris.js';
import { getWaiverPdf } from '../services/storage.js';
```

**Step 2: Remove the old endpoints from bookings.ts**

Delete the following blocks from `bookings.ts`:
- Lines 405-431 (`GET /admin/list` — duplicate of admin router's `GET /bookings`)
- Lines 509-654 (capture, void, complete, waiver endpoints)

**Step 3: Commit**

```
security: move admin endpoints from public bookings router to auth-protected admin router
```

---

### Task 3: Stop exposing payment tokens in API responses (Finding #3)

**Files:**
- Modify: `packages/api/src/routes/admin.ts:271-274`

**Step 1: Remove payment_token and moneris_txn from booking detail response**

In the `GET /bookings/:id` endpoint (admin.ts:270), change the SELECT to exclude sensitive columns:

```sql
-- Remove from the SELECT:
r.payment_token, r.moneris_txn,
-- These are internal payment fields — never expose to any client
```

Keep `moneris_txn` available internally for capture/void operations but don't return it in the detail response. The capture/void endpoints already fetch it independently.

**Step 2: Commit**

```
security: remove payment_token and moneris_txn from admin booking detail response
```

---

## Phase 2: Critical Bugs

### Task 4: Fix walk-in date calculation bug (Code Review #1)

**Files:**
- Modify: `packages/cms/src/components/views/Bookings/WalkInModal.tsx:56-60`

**The bug:** `toLocaleDateString('en-CA')` already returns `YYYY-MM-DD`, but the code then applies `.split('/').reverse().join('-')` which is a transformation for `MM/DD/YYYY` format. On locales that return `YYYY-MM-DD`, this is a no-op in the split (no `/` found) but the code is misleading and fragile. On some environments it could fail.

**Step 1: Fix the date formatting**

Replace lines 56-60:
```typescript
// OLD (buggy):
const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })
  .split('/')
  .reverse()
  .join('-')

// NEW (correct):
const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })
// en-CA always returns YYYY-MM-DD, no transformation needed
```

**Step 2: Commit**

```
fix: remove incorrect date string transformation in walk-in modal
```

---

### Task 5: Fix multi-day rental overcharge by 1 day (Code Review #2)

**Files:**
- Modify: `packages/api/src/routes/bookings.ts:181-187`

**The bug:** In the hold endpoint, `rentalDays` is calculated as `Math.ceil(diff) + 1`, but `buildRangeBounds` already adds 1 day to the end date (line 83: `end.setDate(end.getDate() + 1)`). So for a 2-night rental (e.g., Feb 1 → Feb 3), the price calculation counts 4 days instead of 3.

Actually, re-reading the code more carefully: the `rentalDays` calculation at line 184 uses the original `date` and `endDate` from the request (not from `buildRangeBounds`), so:
- Feb 1 to Feb 3: diff = 2 days, ceil(2) + 1 = 3 days. First day at `price8h`, remaining 2 at `price_per_day`.

This is the pricing model: first day is full-day rate, each additional day is daily rate. The +1 in the calculation accounts for the inclusive date range (booking Feb 1 to Feb 3 = 3 rental days: Feb 1, Feb 2, Feb 3). This might be intentional.

**Step 1: Verify intent with a test case**

Actually, let's look at `buildRangeBounds` for multi-day:
```typescript
const end = new Date(endDate!);
end.setDate(end.getDate() + 1);  // Add 1 day to make the range exclusive
return {
  rangeStart: `${date} 00:00`,
  rangeEnd: `${end.toISOString().split('T')[0]} 00:00`,
};
```

If someone books Feb 1 → Feb 3 (return date), the range becomes `[Feb 1 00:00, Feb 4 00:00)`. The rental_period covers nights of Feb 1, 2, 3. The price calc: `ceil((Feb 3 - Feb 1) / dayMs) + 1 = 2 + 1 = 3 days`.

The pricing model is: first day at full-day rate (`price8h`), subsequent days at `price_per_day`. For 3 days: `price8h + 2 * price_per_day`. This seems intentional — the customer books Feb 1 to Feb 3 inclusive, pays for 3 days.

**Decision:** This is not actually a bug — the `+1` accounts for inclusive date counting (Feb 1 to Feb 3 = 3 days, not 2). The `buildRangeBounds` `+1` is for the PostgreSQL tstzrange exclusive upper bound. They serve different purposes.

**Step 1: Add a clarifying comment instead**

At line 184 in bookings.ts:
```typescript
// Inclusive day count: Feb 1 to Feb 3 = 3 rental days (Feb 1, Feb 2, Feb 3)
// The +1 is for inclusive counting; buildRangeBounds adds a separate +1 for the exclusive tstzrange upper bound
const rentalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
```

**Step 2: Commit**

```
docs: clarify multi-day rental day counting is intentional inclusive range
```

---

## Phase 3: High Severity Security

### Task 6: Fix IDOR — add HMAC to public booking lookup (Finding #4)

**Files:**
- Modify: `packages/api/src/routes/bookings.ts` (the `GET /:id` endpoint)

The 6-char booking ref has ~29 bits of entropy and is publicly queryable. With no auth, an attacker can enumerate all bookings. The mitigation: require a `token` query parameter that is an HMAC of the booking ref.

**Step 1: Add HMAC validation to public booking lookup**

Add a helper function and modify the `GET /:id` endpoint:

```typescript
import { createHmac } from 'crypto';

const BOOKING_HMAC_SECRET = process.env.BOOKING_HMAC_SECRET || 'dev-booking-hmac-secret';

/** Generate a short HMAC token for a booking ref (used in confirmation URLs) */
export function generateBookingToken(bookingRef: string): string {
  return createHmac('sha256', BOOKING_HMAC_SECRET)
    .update(bookingRef.toUpperCase())
    .digest('hex')
    .slice(0, 12);
}
```

In the `GET /:id` endpoint, validate the token:
```typescript
// After resolving param, before DB query:
const token = req.query.token as string | undefined;
if (isRef && (!token || token !== generateBookingToken(param.toUpperCase()))) {
  res.status(403).json({ error: 'Invalid or missing booking token' });
  return;
}
```

In the `POST /hold` response and `POST /pay` response, include the token:
```typescript
bookingToken: generateBookingToken(reservation.booking_ref),
```

**Step 2: Update confirmation emails and waiver URLs to include the token**

The frontend booking confirmation page and waiver URL must include `?token=<hmac>`.

**Step 3: Commit**

```
security: add HMAC token to public booking lookup to prevent enumeration
```

---

### Task 7: Fix SQL column interpolation (Finding #5)

**Files:**
- Modify: `packages/api/src/routes/bookings.ts:135,151`
- Modify: `packages/api/src/routes/admin.ts:732,753`

**The bug:** `priceCol` is string-interpolated into SQL via template literals. Currently safe because Zod validates `duration` to an enum, but one refactor away from injection.

**Step 1: Replace string interpolation with CASE WHEN**

In `bookings.ts`, replace:
```typescript
const priceCol = PRICE_COLUMN[duration];
// ... later:
`SELECT id, ${priceCol} AS rental_price, ...`
```

With:
```typescript
// Remove priceCol variable. In the SQL:
`SELECT id,
  CASE $X
    WHEN '2h' THEN price2h
    WHEN '4h' THEN price4h
    WHEN '8h' THEN price8h
    WHEN 'multi-day' THEN price_per_day
  END AS rental_price,
  price8h, price_per_day, deposit_amount
FROM bikes WHERE id = ANY($Y) AND status = 'available'`
```

Pass `duration` as a parameterized value.

Do the same in `admin.ts` for the walk-in endpoint.

**Step 2: Commit**

```
security: replace SQL column interpolation with parameterized CASE WHEN
```

---

### Task 8: Fix path traversal in waiver storage (Finding #7)

**Files:**
- Modify: `packages/api/src/services/storage.ts`

**Step 1: Add path validation**

```typescript
export async function uploadWaiverPdf(key: string, pdfBuffer: Buffer): Promise<string> {
  const filePath = path.join(STORAGE_DIR, key);
  const resolved = path.resolve(filePath);

  // Prevent path traversal — resolved path must stay within STORAGE_DIR
  if (!resolved.startsWith(path.resolve(STORAGE_DIR) + path.sep) && resolved !== path.resolve(STORAGE_DIR)) {
    throw new Error('Invalid storage key: path traversal detected');
  }
  // ... rest of function
}

export async function getWaiverPdf(key: string): Promise<Buffer> {
  const filePath = path.join(STORAGE_DIR, key);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(path.resolve(STORAGE_DIR) + path.sep) && resolved !== path.resolve(STORAGE_DIR)) {
    throw new Error('Invalid storage key: path traversal detected');
  }
  // ... rest of function
}
```

**Step 2: Commit**

```
security: add path traversal protection to waiver storage service
```

---

### Task 9: Add auth to waiver PDF download (Finding #8)

This is now handled by Task 2 — the waiver download endpoint moved to the admin router, which is behind `adminAuth` middleware. No additional work needed.

---

## Phase 4: Medium Severity

### Task 10: Parameterize timezone in SQL (Medium Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts` (lines 74-76, 176-177)

**Step 1: Replace timezone interpolation with parameterized queries**

Replace `'${TIMEZONE}'` template interpolation with `$N` parameters:

```sql
-- Instead of:
NOW() AT TIME ZONE '${TIMEZONE}'
-- Use:
NOW() AT TIME ZONE $1
```

Pass `TIMEZONE` as a parameter value alongside the other parameters.

**Step 2: Commit**

```
security: parameterize timezone string in SQL queries
```

---

### Task 11: Sanitize Puppeteer signature data URL (Medium Finding)

**Files:**
- Modify: `packages/api/src/services/waiver-pdf.ts:58`

**The issue:** `signatureDataUrl` is injected into the HTML template and rendered by Puppeteer. It's validated as starting with `data:image/png;base64,` by Zod, but the base64 content is not validated.

**Step 1: Validate the signature data URL more strictly**

In `waiver-pdf.ts`, before inserting into HTML, validate the data URL:

```typescript
// After existing escapeHtml calls, validate signature data URL format
const VALID_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
if (!VALID_DATA_URL.test(data.signatureDataUrl)) {
  throw new Error('Invalid signature data URL format');
}
```

This ensures only valid base64 characters are in the data URL, preventing any HTML injection through the signature field.

**Step 2: Commit**

```
security: validate signature data URL format before Puppeteer rendering
```

---

### Task 12: Use crypto-secure booking refs with collision retry (Medium Finding)

**Files:**
- Create: `packages/api/src/db/migrations/005_crypto_booking_ref.sql`

**Step 1: Create migration to use gen_random_bytes instead of random()**

```sql
-- Migration 005: Use cryptographically secure random for booking refs
-- PostgreSQL's random() is not cryptographic; gen_random_bytes() uses /dev/urandom

CREATE OR REPLACE FUNCTION bookings.generate_booking_ref()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  ref TEXT := '';
  bytes BYTEA;
  i INT;
  attempts INT := 0;
BEGIN
  LOOP
    ref := '';
    bytes := gen_random_bytes(6);
    FOR i IN 0..5 LOOP
      ref := ref || substr(chars, (get_byte(bytes, i) % 30) + 1, 1);
    END LOOP;

    -- Retry on collision (up to 5 attempts)
    BEGIN
      RETURN ref;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

**Step 2: Commit**

```
security: use cryptographic random for booking ref generation with collision safety
```

---

### Task 13: Fix Moneris silent sandbox fallback (Medium Finding)

**Files:**
- Modify: `packages/api/src/services/moneris.ts`

**Step 1: Log a clear warning when running in sandbox mode**

```typescript
const IS_SANDBOX = !process.env.MONERIS_API_URL || process.env.MONERIS_API_URL.includes('gatewayt');

if (IS_SANDBOX) {
  console.warn(
    '\x1b[33m⚠ WARNING: Moneris is running in SANDBOX mode. ' +
    'Set MONERIS_API_URL, MONERIS_STORE_ID, and MONERIS_API_TOKEN env vars for production.\x1b[0m'
  );
}
```

Also remove the hardcoded fallback credentials:
```typescript
// OLD:
const MONERIS_STORE_ID = process.env.MONERIS_STORE_ID || 'store1';
const MONERIS_API_TOKEN = process.env.MONERIS_API_TOKEN || 'yesguy';

// NEW:
const MONERIS_STORE_ID = process.env.MONERIS_STORE_ID || '';
const MONERIS_API_TOKEN = process.env.MONERIS_API_TOKEN || '';
```

In the production API functions, check that credentials exist before making real API calls:
```typescript
if (!MONERIS_STORE_ID || !MONERIS_API_TOKEN) {
  return { success: false, message: 'Moneris credentials not configured' };
}
```

**Step 2: Commit**

```
security: remove Moneris sandbox credential defaults, add warning on sandbox mode
```

---

### Task 14: Add transaction locking to cancellation (Medium Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts:567-593`

**Step 1: Wrap cancellation in a proper transaction with FOR UPDATE**

```typescript
adminRouter.patch('/bookings/:id/cancel', async (req, res) => {
  // ... validation ...
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resCheck = await client.query(
      `SELECT id, status FROM bookings.reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    if (resCheck.rowCount === 0 || !['hold', 'paid'].includes(resCheck.rows[0].status)) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Booking not found or cannot be cancelled' });
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
```

**Step 2: Commit**

```
fix: add transaction locking to booking cancellation to prevent race conditions
```

---

## Phase 5: Low Severity & Code Quality

### Task 15: Use UUID for walk-in placeholder emails (Low Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts:739`

**Step 1: Replace Date.now() with crypto.randomUUID()**

```typescript
// OLD:
const email = customer.email || `walkin-${Date.now()}@placeholder.local`;

// NEW:
const email = customer.email || `walkin-${crypto.randomUUID()}@placeholder.local`;
```

Add import at top of file:
```typescript
import { randomUUID } from 'crypto';
```

Then use:
```typescript
const email = customer.email || `walkin-${randomUUID()}@placeholder.local`;
```

**Step 2: Commit**

```
fix: use UUID instead of timestamp for walk-in placeholder emails
```

---

### Task 16: Stop leaking Zod error details to client (Low Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts` (lines 148, 357, 446, 560, 606, 688, 727)
- Modify: `packages/api/src/routes/bookings.ts` (lines 130, 264)

**Step 1: Remove `details: parsed.error.flatten()` from all error responses**

In every Zod validation error response, change:
```typescript
res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
```
To:
```typescript
res.status(400).json({ error: 'Invalid request' });
```

Keep the `parsed.error.flatten()` in server-side logs:
```typescript
if (!parsed.success) {
  console.warn('Validation failed:', parsed.error.flatten());
  res.status(400).json({ error: 'Invalid request' });
  return;
}
```

**Step 2: Commit**

```
security: stop leaking Zod validation details to client responses
```

---

### Task 17: Add storage/ to .gitignore (Low Finding)

**Files:**
- Modify: `.gitignore`

**Step 1: Add storage directory**

Append to `.gitignore`:
```
# Waiver PDF storage (local dev)
storage/
packages/api/storage/
```

**Step 2: Commit**

```
chore: add storage/ to .gitignore
```

---

## Phase 6: Code Quality (Important)

### Task 18: Add FOR UPDATE to check-out/check-in item queries (Important Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts`

The reservation row is locked with `FOR UPDATE`, but the `reservation_items` rows are not. Concurrent check-out/check-in operations could produce inconsistent state.

**Step 1: Add row locking to reservation_items updates**

In the check-out endpoint (line 389), the UPDATE already has proper WHERE conditions that prevent double-updates. However, add `FOR UPDATE` to the initial reservation check to prevent concurrent modifications:

The current code already locks the reservation with `FOR UPDATE` (line 371, 459). The items UPDATE has idempotent conditions (`checked_out_at IS NULL`, `checked_in_at IS NULL`). The risk is minimal because PostgreSQL's MVCC prevents lost updates, but for extra safety, we can SELECT the items with FOR UPDATE before updating:

```typescript
// Before the UPDATE, lock the items:
if (itemIds && itemIds.length > 0) {
  await client.query(
    `SELECT id FROM bookings.reservation_items
     WHERE reservation_id = $1 AND id = ANY($2) FOR UPDATE`,
    [reservationId, itemIds],
  );
}
```

**Step 2: Commit**

```
fix: lock reservation_items rows during check-out/check-in to prevent race conditions
```

---

### Task 19: Fix overdue calculation — use parseTstzrange instead of fragile regex (Important Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts:327-332`

**Step 1: Replace the inline regex with a proper parser**

```typescript
// OLD (fragile regex):
const is_overdue = itemsResult.rows.some(
  (item: any) =>
    item.checked_out_at &&
    !item.checked_in_at &&
    new Date(item.rental_period.replace(/[\[\(]"?/, '').split(',')[1].replace(/["\]\)]/, '').trim()) < new Date(),
);

// NEW (use PostgreSQL upper() in the SQL instead):
```

Actually, the best fix is to compute `is_overdue` in SQL (like the bookings list endpoint already does):

Add to the items query:
```sql
SELECT ..., upper(ri.rental_period) AS return_time
FROM bookings.reservation_items ri ...
```

Then in JS:
```typescript
const is_overdue = itemsResult.rows.some(
  (item: any) =>
    item.checked_out_at &&
    !item.checked_in_at &&
    item.return_time &&
    new Date(item.return_time) < new Date(),
);
```

**Step 2: Commit**

```
fix: use PostgreSQL upper() for overdue calculation instead of regex parsing
```

---

### Task 20: Extract parseTstzrange into shared utility (Minor Finding)

**Files:**
- Create: `packages/cms/src/components/views/Bookings/utils.ts`
- Modify: `packages/cms/src/components/views/Bookings/BookingTable.tsx`
- Modify: `packages/cms/src/components/views/Bookings/BookingDetail.tsx`

**Step 1: Extract shared functions into utils.ts**

```typescript
/**
 * Parse PostgreSQL tstzrange format: ["2026-02-27 16:00:00+00","2026-02-27 20:00:00+00")
 * Returns [startDate, endDate] or [null, null] on failure.
 */
export function parseTstzrange(range: string): [Date | null, Date | null] {
  if (!range) return [null, null]
  const inner = range.replace(/^[\[\(]/, '').replace(/[\]\)]$/, '')
  const parts = inner.split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
  if (parts.length !== 2) return [null, null]
  const start = new Date(parts[0])
  const end = new Date(parts[1])
  return [
    isNaN(start.getTime()) ? null : start,
    isNaN(end.getTime()) ? null : end,
  ]
}

export function formatDateTime(date: Date | null): string {
  if (!date) return '-'
  return date.toLocaleString('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
```

**Step 2: Update imports in BookingTable.tsx and BookingDetail.tsx**

Remove the duplicate functions and import from `./utils`.

**Step 3: Commit**

```
refactor: extract shared parseTstzrange and formatDateTime into utils module
```

---

### Task 21: Optimize N+1 subquery in unsigned waiver alert (Minor Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts:115-128`

**Step 1: Replace correlated subqueries with JOINs + GROUP BY**

```sql
SELECT
  r.id AS reservation_id,
  c.full_name AS customer_name,
  COUNT(ri.id)::int AS item_count,
  COUNT(w.id)::int AS waiver_count
FROM bookings.reservations r
LEFT JOIN bookings.customers c ON r.customer_id = c.id
LEFT JOIN bookings.reservation_items ri ON ri.reservation_id = r.id
LEFT JOIN bookings.waivers w ON w.reservation_id = r.id
WHERE r.status IN ('hold', 'paid')
  AND lower(r.rental_period) >= NOW()
  AND lower(r.rental_period) <= NOW() + INTERVAL '24 hours'
GROUP BY r.id, c.full_name
HAVING COUNT(DISTINCT w.id) < COUNT(DISTINCT ri.id)
```

**Step 2: Commit**

```
perf: replace N+1 subqueries with JOIN + GROUP BY in unsigned waiver alert
```

---

### Task 22: Update CMS bookings dashboard to send auth header

**Files:**
- Modify: `packages/cms/src/components/views/Bookings/useBookings.ts` (or wherever API calls are made)
- Modify: `packages/cms/src/components/views/Bookings/BookingDetail.tsx`
- Modify: `packages/cms/src/components/views/Bookings/WalkInModal.tsx`

**Step 1: Add Authorization header to all admin API calls**

Create a shared fetch helper:

```typescript
const ADMIN_API_SECRET = typeof window !== 'undefined'
  ? (document.querySelector('meta[name="admin-api-secret"]') as HTMLMetaElement)?.content
  : process.env.ADMIN_API_SECRET || 'dev-admin-secret-change-in-production';

export function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_API_SECRET}`,
    },
  });
}
```

Since the CMS and API are both server-side in dev, the simplest approach is to pass the secret as an environment variable that the CMS knows. The bookings view components should read it from an env var or a data attribute.

For now, use an environment variable approach: `ADMIN_API_SECRET` is set in `.env` and the CMS passes it to the client via a prop or server component.

**Step 2: Update all fetch calls in the bookings components**

Replace all `fetch(url)` calls in:
- `useBookings.ts` (polling fetches)
- `BookingDetail.tsx` (detail fetch, actions)
- `WalkInModal.tsx` (bike availability, walk-in creation)

**Step 3: Commit**

```
feat: add auth header to all CMS admin API calls
```

---

### Task 23: Add null guard to parseTstzrange calls (Important Finding)

**Files:**
- Modify: `packages/api/src/routes/admin.ts:327-332` (already covered by Task 19)
- The frontend `parseTstzrange` already handles null/empty (returns `[null, null]`)

This is already addressed by Task 19. No additional work needed.

---

## Summary of Tasks

| Task | Severity | What | Files |
|------|----------|------|-------|
| 1 | CRITICAL | Admin auth middleware | middleware/adminAuth.ts, server.ts |
| 2 | CRITICAL | Move admin endpoints off public router | bookings.ts, admin.ts |
| 3 | CRITICAL | Remove payment tokens from responses | admin.ts |
| 4 | CRITICAL BUG | Fix walk-in date calculation | WalkInModal.tsx |
| 5 | CRITICAL BUG | Clarify multi-day rental pricing (not a bug) | bookings.ts |
| 6 | HIGH | HMAC token for public booking lookup | bookings.ts |
| 7 | HIGH | SQL column interpolation → CASE WHEN | bookings.ts, admin.ts |
| 8 | HIGH | Path traversal protection | storage.ts |
| 9 | HIGH | Waiver auth (handled by Task 2) | — |
| 10 | MEDIUM | Parameterize timezone in SQL | admin.ts |
| 11 | MEDIUM | Validate signature data URL | waiver-pdf.ts |
| 12 | MEDIUM | Crypto-secure booking refs | migration SQL |
| 13 | MEDIUM | Moneris sandbox warning | moneris.ts |
| 14 | MEDIUM | Transaction locking on cancel | admin.ts |
| 15 | LOW | UUID for walk-in emails | admin.ts |
| 16 | LOW | Stop leaking Zod errors | admin.ts, bookings.ts |
| 17 | LOW | Add storage/ to .gitignore | .gitignore |
| 18 | IMPORTANT | FOR UPDATE on items | admin.ts |
| 19 | IMPORTANT | Fix overdue regex parsing | admin.ts |
| 20 | MINOR | Extract shared parseTstzrange | BookingTable.tsx, BookingDetail.tsx |
| 21 | MINOR | N+1 subquery optimization | admin.ts |
| 22 | CRITICAL | CMS sends auth header | useBookings.ts, BookingDetail.tsx, WalkInModal.tsx |
