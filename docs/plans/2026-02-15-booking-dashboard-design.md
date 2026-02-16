# Booking Management Dashboard — Design Document

**Date:** 2026-02-15
**Status:** Approved
**Scope:** Admin dashboard for managing bike rentals + multi-bike booking support + QR waiver system

---

## 1. Problem Statement

Joe's Garage has a working online booking flow (date → duration → time → bike → waiver → payment) but **no way for Joe to manage bookings**. The Express API has admin endpoints (`/admin/list`, `/capture`, `/void`, `/complete`) but no UI. Joe also handles walk-in customers daily and needs to process them quickly. Additionally, the current system only supports one bike per booking — families renting multiple bikes must create separate bookings.

### Goals
1. Give Joe a full booking management dashboard inside Payload CMS
2. Support multi-bike bookings (families, groups)
3. Streamline walk-in processing to under 60 seconds
4. QR code waiver system for in-shop signing
5. Real-time visibility into fleet status, overdue rentals, and upcoming bookings

---

## 2. Architecture

### System Boundaries

```
Payload CMS (Next.js, port 3003)        Express API (port 3001)         PostgreSQL
┌──────────────────────────┐     fetch    ┌─────────────────────┐        ┌──────────┐
│  /admin/bookings         │ ──────────── │  /api/admin/*       │ ────── │ bookings │
│  (Custom React view)     │              │  /api/bookings/*    │        │ schema   │
│                          │              │  /api/availability  │        │          │
│  /admin (standard CMS)   │              │  /api/waivers       │        │ public   │
│  Bikes, Media, Pages...  │              └─────────────────────┘        │ schema   │
└──────────────────────────┘                                             └──────────┘
                                          Astro Frontend (port 4321)
                                          ┌─────────────────────┐
                                          │  /book (booking flow)│
                                          │  /waiver/:ref (QR)  │
                                          └─────────────────────┘
```

- **Payload CMS** owns the admin UI (React components inside the admin panel)
- **Express API** owns all booking business logic and database queries
- **Astro frontend** owns the customer-facing booking flow and QR waiver page
- Dashboard fetches from Express API via `fetch()` with 30-second polling

### Tech Decisions
- **No WebSockets** — 30s polling is sufficient for 14 bikes
- **No new dependencies** — uses Payload UI primitives + custom CSS
- **Server-client hybrid** — server component for admin shell, client component for interactivity
- **No auth middleware yet** — admin routes are currently public (production TODO)

---

## 3. Database Schema Changes

### Current Schema

```sql
-- bookings.reservations (current)
id              UUID PRIMARY KEY
customer_id     UUID REFERENCES bookings.customers(id)
bike_id         INTEGER NOT NULL          -- single bike per booking
rental_period   TSTZRANGE NOT NULL
duration_type   TEXT CHECK ('2h','4h','8h','multi-day')
status          TEXT DEFAULT 'hold'       -- hold, paid, active, completed, cancelled
hold_expires    TIMESTAMPTZ
payment_token   TEXT
moneris_txn     TEXT
total_amount    NUMERIC(10,2)
deposit_amount  NUMERIC(10,2)
created_at      TIMESTAMPTZ DEFAULT NOW()
updated_at      TIMESTAMPTZ DEFAULT NOW()

-- EXCLUDE constraint: (bike_id WITH =, rental_period WITH &&) WHERE status != 'cancelled'
```

### New Schema

#### Migration: `003_multi_bike_bookings.sql`

**Step 1: Create `reservation_items` table**

```sql
CREATE TABLE bookings.reservation_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  UUID NOT NULL REFERENCES bookings.reservations(id) ON DELETE CASCADE,
  bike_id         INTEGER NOT NULL,
  rental_price    NUMERIC(10,2) NOT NULL,
  deposit_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  checked_out_at  TIMESTAMPTZ,           -- when bike was physically handed over
  checked_in_at   TIMESTAMPTZ,           -- when bike was physically returned
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent double-booking: same bike can't overlap in time
-- Uses the parent reservation's rental_period for the range check
ALTER TABLE bookings.reservation_items
  ADD CONSTRAINT reservation_items_bike_period_excl
  EXCLUDE USING gist (
    bike_id WITH =,
    (SELECT rental_period FROM bookings.reservations WHERE id = reservation_id) WITH &&
  )
  WHERE (
    (SELECT status FROM bookings.reservations WHERE id = reservation_id) NOT IN ('cancelled')
  );
```

> **Note:** The EXCLUDE constraint on reservation_items referencing the parent reservation's rental_period via subquery may not work directly in PostgreSQL. Alternative approach: duplicate `rental_period` on `reservation_items` or use a trigger-based check. The implementation plan will determine the exact constraint strategy.

**Step 2: Add `source` column to reservations**

```sql
ALTER TABLE bookings.reservations
  ADD COLUMN source TEXT NOT NULL DEFAULT 'website'
  CHECK (source IN ('website', 'walk-in', 'phone'));
```

**Step 3: Add minor/guardian support to waivers**

```sql
ALTER TABLE bookings.waivers
  ADD COLUMN is_minor BOOLEAN DEFAULT false,
  ADD COLUMN guardian_customer_id UUID REFERENCES bookings.customers(id);
```

**Step 4: Migrate existing data**

```sql
-- Move existing bike_id + pricing into reservation_items
INSERT INTO bookings.reservation_items (reservation_id, bike_id, rental_price, deposit_amount)
SELECT id, bike_id, total_amount - COALESCE(deposit_amount, 0), COALESCE(deposit_amount, 0)
FROM bookings.reservations
WHERE bike_id IS NOT NULL;
```

**Step 5: Drop old bike_id column**

```sql
-- Remove old EXCLUDE constraint first
ALTER TABLE bookings.reservations DROP CONSTRAINT IF EXISTS reservations_bike_id_rental_period_excl;
-- Drop indexes that reference bike_id
DROP INDEX IF EXISTS bookings.idx_reservations_bike;
-- Make bike_id nullable (keep for backward compat during migration), then drop
ALTER TABLE bookings.reservations DROP COLUMN bike_id;
```

**Step 6: Add new EXCLUDE constraint on reservation_items**

```sql
-- Each bike can only be in one active reservation for any time period
-- Store rental_period on reservation_items for the EXCLUDE constraint
ALTER TABLE bookings.reservation_items
  ADD COLUMN rental_period TSTZRANGE;

-- Backfill from parent reservation
UPDATE bookings.reservation_items ri
SET rental_period = r.rental_period
FROM bookings.reservations r
WHERE ri.reservation_id = r.id;

ALTER TABLE bookings.reservation_items
  ALTER COLUMN rental_period SET NOT NULL;

-- Create the EXCLUDE constraint
ALTER TABLE bookings.reservation_items
  ADD CONSTRAINT items_bike_period_excl
  EXCLUDE USING gist (bike_id WITH =, rental_period WITH &&);

CREATE INDEX idx_reservation_items_reservation ON bookings.reservation_items(reservation_id);
CREATE INDEX idx_reservation_items_bike ON bookings.reservation_items(bike_id);
```

### Final Schema (after migration)

```
bookings.reservations
  id, customer_id, rental_period, duration_type, status, source,
  hold_expires, payment_token, moneris_txn, total_amount, deposit_amount,
  created_at, updated_at

bookings.reservation_items
  id, reservation_id, bike_id, rental_period (denormalized for EXCLUDE),
  rental_price, deposit_amount, checked_out_at, checked_in_at, created_at

bookings.waivers
  id, reservation_id, customer_id, pdf_storage_key, pdf_sha256,
  signed_at, signer_ip, signer_ua, consent_electronic, consent_terms,
  is_minor, guardian_customer_id, created_at

bookings.customers
  id, full_name, email, phone, date_of_birth, created_at
```

---

## 4. Admin Dashboard Layout

### Registration in Payload Config

```typescript
// payload.config.ts — admin.components additions
{
  afterNavLinks: ['/src/components/admin/BookingsNavLink'],
  views: {
    bookings: {
      Component: '/src/components/views/Bookings/index#BookingsView',
      path: '/bookings',
      exact: true,
      meta: { title: 'Bookings Dashboard' },
    },
  },
}
```

### Four-Zone Layout

**Zone 1: KPI Cards (always visible, top row)**

| Card | Data | Color |
|------|------|-------|
| Active Rentals | Bikes currently checked out | Green |
| Returns Due Today | Expected back today | Blue (amber if within 1 hour) |
| Overdue | Past return time, not checked in | Red |
| Available Fleet | Bikes with status='available' not in active bookings | Neutral |

Data source: single `GET /api/admin/dashboard` call.

**Zone 2: Alert Bar (conditional)**

Shows only when action is needed:
- **Red:** Overdue returns with customer name, bike, and how long overdue
- **Amber:** Upcoming bookings with unsigned waivers

Collapses to zero height when empty. Each alert links to the booking detail panel.

**Zone 3: Booking Table (main content)**

Header row: Search bar + Filter chips (All | Today | Upcoming | Active | Overdue | Completed)

| Column | Content |
|--------|---------|
| Status | Colored badge (Reserved, Active, Overdue, Completed, Cancelled) |
| Customer | Name (tap to expand) |
| Bikes | Type × count (e.g. "City Cruiser × 2, Kids × 1") |
| Duration | 2h / 4h / Full Day / Multi-Day |
| Pickup | Date + time |
| Return | Date + time |
| Waivers | ✓ 3/3 or ⚠ 2/3 |
| Actions | Context-sensitive button (Check Out / Check In) |

Pagination: 25 rows per page. Sortable by any column. Clicking a row opens Zone 4.

**Zone 4: Slide-Out Detail Panel (right side, 400px)**

Sections:
1. **Header:** Booking ref (#JG-0042), status badge, source tag (Website/Walk-in)
2. **Customer:** Name, phone (tap-to-call), email, returning customer badge
3. **Bikes:** Mini-table with per-bike status, price, check-in/out timestamps
4. **Waivers:** Checklist per rider (signed/pending), view signature, resend link
5. **Timeline:** Chronological activity log
6. **Actions:** Context-sensitive buttons based on booking status

Action matrix:

| Status | Actions |
|--------|---------|
| Reserved (hold/paid) | Check Out, Cancel, Add Note |
| Active (checked out) | Check In (per bike or all), Extend, Swap Bike, Add Note |
| Overdue | Check In, Add Note |
| Returned | Complete, Add Note |
| Completed | View Only |

### Fleet Status Widget (collapsible)

Positioned as a toggle-able panel below the KPI cards. Shows horizontal stacked bars per bike category:

```
City Cruiser   ████████░░░░  6/10 available
Road Bike      ██░░░░░░░░░░  1/4 available
Kids Bike      ████████████  3/3 available
Trail-a-Bike   ██████░░░░░░  1/2 available
```

Colors: green=available, blue=reserved, teal=out, red=overdue, gray=maintenance.

### "New Walk-in" Button

Prominent button in the top-right header area. Opens a modal with this flow:

1. **Pick bikes:** Grid of available bike types with quantity +/- controls. Price shown per duration.
2. **Duration + customer:** Duration chips (2h/4h/Full Day) + name, phone, email fields. Start time = now.
3. **Waiver:** Display QR code for customer to scan. Real-time status updates as riders sign.
4. **Payment:** "Payment collected" toggle (cash/card/e-transfer). No online gateway.
5. **Done:** Booking goes directly to Active status. Appears in table immediately.

---

## 5. Status Color System

| Status | Color | Hex | Icon |
|--------|-------|-----|------|
| Hold (pending payment) | Gray | #9CA3AF | Clock |
| Reserved (paid, upcoming) | Blue | #3B82F6 | Calendar |
| Active (checked out) | Green | #10B981 | Bike |
| Overdue | Red | #EF4444 | Alert triangle |
| Returned (pending inspection) | Amber | #F59E0B | Clipboard |
| Completed | Muted green | #6B7280 | Checkmark |
| Cancelled | Light gray | #D1D5DB | X (strikethrough text) |

Always pair color with text label — never color alone.

---

## 6. Multi-Bike Website Booking Flow

### Updated Steps

**Step 1 — Date, Duration, Time (unchanged)**
Same as current. Applies to entire group.

**Step 2 — Build Your Group (redesigned)**

Bike grid shows quantity controls instead of one-click select:
- Each card: photo, name, type, price for duration, deposit
- Quantity: "−" / count / "+" buttons (0 to available)
- Sticky summary bar at bottom: item list, subtotal, deposits, rider count, "Continue" button

"Continue" creates holds on all selected bikes in one API call. Single hold timer for the group.

**Step 3 — Waivers (redesigned for multi-rider)**

Rider checklist: for each rider, enter name/email/phone/DOB + sign waiver.
- QR code displayed: "Other riders can scan this to sign on their phone"
- Progress indicator: "Waiver 2 of 3 complete"
- Minor detection: if DOB shows under 18, add parent/guardian field
- Riders sign in any order, on any device

**Step 4 — Payment (mostly unchanged)**
Shows group total: all rental prices + all deposits. One payment.

**Step 5 — Confirmation**
Lists all bikes, all riders, waiver status, total paid.

### QR Waiver Page

New Astro page at `/waiver/:bookingRef`:
- No login required (booking ref in URL is the auth)
- Shows which riders still need to sign
- "I am [name]" selector or "I'm a new rider in this group"
- Signature pad + consent checkboxes
- Submits to `POST /api/waivers` with reservation reference
- Real-time updates back to dashboard via polling

---

## 7. API Endpoints (New + Modified)

### New Admin Endpoints

```
GET  /api/admin/dashboard
  Returns: { activeRentals, returnsDueToday, overdue, availableFleet, alerts[] }

GET  /api/admin/bookings?status=&date=&search=&page=&limit=
  Returns: { bookings[], total, page, pages }
  (Enhanced version of existing /admin/list with pagination, filtering, search)

GET  /api/admin/bookings/:id
  Returns: Full booking detail with items, waivers, customer, timeline

POST /api/admin/walk-in
  Body: { bikes: [{bikeType, quantity}], duration, customer: {name, phone, email} }
  Returns: { reservationId, waiverQrUrl }

PATCH /api/admin/bookings/:id/check-out
  Body: { bikeItemIds?: string[] }  (optional: check out specific bikes, default all)
  Returns: { status, checkedOutItems }

PATCH /api/admin/bookings/:id/check-in
  Body: { bikeItemIds?: string[], notes?: string }
  Returns: { status, checkedInItems }

PATCH /api/admin/bookings/:id/extend
  Body: { newDuration | newReturnTime }
  Returns: { newTotal, conflicts? }

PATCH /api/admin/bookings/:id/cancel
  Body: { reason: string }
  Returns: { status: 'cancelled' }

POST /api/admin/bookings/:id/note
  Body: { text: string }
  Returns: { noteId, createdAt }
```

### Modified Endpoints

```
POST /api/bookings/hold
  Body: { bikes: [{bikeId, quantity}], date, duration, startTime?, endDate? }
  Changed: accepts array of bikes instead of single bikeId

POST /api/waivers
  Body: { reservationId, signatureDataUrl, fullName, email, phone, dateOfBirth,
          consentElectronic, consentTerms, isMinor?, guardianName? }
  Changed: linked to reservation (not specific bike), minor support added

GET  /api/availability
  Unchanged — still returns bikes available for a time period
```

---

## 8. Overdue Handling

- **Dashboard flags:** Red KPI card, alert bar, table row floats to top with red badge
- **No automatic charges:** Joe decides manually what to do
- **Available actions:** Extend rental (waive or charge difference), check in as-is, add note
- **Future enhancement:** Optional SMS notification after 30 minutes overdue

---

## 9. File Structure

### New Files in `packages/cms/src/`

```
components/
  views/
    Bookings/
      index.tsx              — Server component (DefaultTemplate wrapper)
      BookingsClient.tsx     — Main client component (state, polling, layout)
      KPICards.tsx            — Four summary stat cards
      AlertBar.tsx           — Conditional overdue/waiver warnings
      BookingTable.tsx        — Filterable, sortable, paginated table
      BookingDetail.tsx       — Slide-out panel with full details + actions
      WalkInModal.tsx         — Walk-in booking flow (4 steps)
      FleetStatus.tsx         — Collapsible fleet availability widget
      StatusBadge.tsx         — Reusable colored status pill
      useBookings.ts          — Custom hook for data fetching + polling
  nav/
    BookingsNavLink.tsx       — Sidebar navigation link
```

### New Files in `packages/api/src/`

```
routes/
  admin.ts                   — Admin dashboard + booking management routes
db/
  migrations/
    003_multi_bike_bookings.sql  — Schema migration
```

### New Files in `packages/frontend/src/`

```
pages/
  waiver/
    [ref].astro              — QR waiver signing page
```

### Modified Files

```
packages/cms/src/payload.config.ts           — Register view + nav link
packages/cms/src/app/(payload)/custom.scss   — Dashboard styles
packages/api/src/routes/bookings.ts          — Multi-bike hold, updated confirmation
packages/api/src/routes/availability.ts      — No changes needed
packages/api/src/index.ts                    — Mount admin router
packages/frontend/src/alpine.ts              — Multi-bike cart logic
packages/frontend/src/pages/book/index.astro — Multi-bike UI (quantity selectors)
```

---

## 10. Non-Functional Requirements

- **Performance:** Dashboard loads in under 2 seconds. Table renders 100+ bookings smoothly.
- **Mobile:** Dashboard should be usable on Joe's phone (responsive table → card layout on small screens).
- **Polling:** 30-second interval for live data. KPI cards and alert bar update without full page refresh.
- **Error handling:** Network failures show a non-blocking toast, not a full error page. Stale data is better than no data.
- **Styles:** Use Payload CSS variables for theme consistency. Custom CSS in `custom.scss` following the existing three-layer architecture.

---

## 11. Out of Scope (Future Enhancements)

- Authentication middleware on admin API routes
- SMS/email notifications for overdue rentals
- Calendar/timeline view (Gantt-style per bike)
- Kanban board view
- Reporting/analytics (revenue, utilization, peak times)
- Bike maintenance scheduling
- Customer loyalty/repeat booking tracking
- Thule baby trailer inventory
- "Return by 6 PM or pay for another day" auto-enforcement
