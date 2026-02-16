-- Migration 003: Multi-bike bookings, reservation notes, walk-in/phone sources
-- Moves per-bike data into reservation_items table to support multi-bike bookings.
-- Adds source tracking, minor/guardian waiver support, and admin notes.

-- ============================================================
-- 1. Create reservation_items table (one row per bike per booking)
-- ============================================================
CREATE TABLE bookings.reservation_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id   UUID NOT NULL
                     REFERENCES bookings.reservations(id) ON DELETE CASCADE,
  bike_id          INTEGER NOT NULL,
  rental_period    TSTZRANGE NOT NULL,
  rental_price     NUMERIC(10,2) NOT NULL,
  deposit_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  checked_out_at   TIMESTAMPTZ,
  checked_in_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent double-booking at the item level
  EXCLUDE USING gist (
    bike_id WITH =,
    rental_period WITH &&
  )
);

CREATE INDEX idx_reservation_items_reservation
  ON bookings.reservation_items (reservation_id);

CREATE INDEX idx_reservation_items_bike
  ON bookings.reservation_items (bike_id);

CREATE INDEX idx_reservation_items_period
  ON bookings.reservation_items USING gist (rental_period);

-- ============================================================
-- 2. Add source column to reservations
-- ============================================================
ALTER TABLE bookings.reservations
  ADD COLUMN source TEXT NOT NULL DEFAULT 'website';

ALTER TABLE bookings.reservations
  ADD CONSTRAINT chk_source
    CHECK (source IN ('website', 'walk-in', 'phone'));

-- ============================================================
-- 3. Add minor/guardian support to waivers
-- ============================================================
ALTER TABLE bookings.waivers
  ADD COLUMN is_minor BOOLEAN DEFAULT false;

ALTER TABLE bookings.waivers
  ADD COLUMN guardian_customer_id UUID
    REFERENCES bookings.customers(id);

-- ============================================================
-- 4. Create notes table
-- ============================================================
CREATE TABLE bookings.notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  UUID NOT NULL
                    REFERENCES bookings.reservations(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  created_by      TEXT NOT NULL DEFAULT 'admin',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notes_reservation
  ON bookings.notes (reservation_id);

-- ============================================================
-- 5. Migrate existing reservation data into reservation_items
-- ============================================================
INSERT INTO bookings.reservation_items (
  reservation_id, bike_id, rental_period, rental_price, deposit_amount
)
SELECT
  id,
  bike_id,
  rental_period,
  COALESCE(total_amount, 0),
  COALESCE(deposit_amount, 0)
FROM bookings.reservations
WHERE bike_id IS NOT NULL;

-- ============================================================
-- 6. Drop old EXCLUDE constraint on reservations
--    (reservation_items table now handles double-booking prevention)
-- ============================================================
ALTER TABLE bookings.reservations
  DROP CONSTRAINT reservations_bike_id_rental_period_excl;

-- ============================================================
-- 7. Make bike_id nullable on reservations
--    (items table owns the per-bike relationship now)
-- ============================================================
ALTER TABLE bookings.reservations
  ALTER COLUMN bike_id DROP NOT NULL;
