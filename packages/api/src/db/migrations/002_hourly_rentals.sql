-- Migration 002: Convert DATERANGE to TSTZRANGE for hourly rentals
-- Enables same-day hourly overlap checking (2h/4h/8h slots)

BEGIN;

-- 1. Add new columns
ALTER TABLE bookings.reservations
  ADD COLUMN rental_period TSTZRANGE,
  ADD COLUMN duration_type TEXT;

-- 2. Migrate existing DATERANGE data to TSTZRANGE
-- [date_a, date_b] → [date_a 00:00 America/Edmonton, upper(date_b) 00:00 America/Edmonton)
-- Existing bookings become all-day multi-day rentals
UPDATE bookings.reservations
SET
  rental_period = tstzrange(
    lower(rental_dates)::timestamp AT TIME ZONE 'America/Edmonton',
    upper(rental_dates)::timestamp AT TIME ZONE 'America/Edmonton',
    '[)'
  ),
  duration_type = 'multi-day';

-- 3. Make rental_period NOT NULL now that data is migrated
ALTER TABLE bookings.reservations
  ALTER COLUMN rental_period SET NOT NULL;

-- 4. Add CHECK constraint for duration_type
ALTER TABLE bookings.reservations
  ADD CONSTRAINT chk_duration_type
    CHECK (duration_type IN ('2h', '4h', '8h', 'multi-day'));

-- 5. Drop old EXCLUDE constraint and indexes that reference rental_dates
ALTER TABLE bookings.reservations
  DROP CONSTRAINT IF EXISTS reservations_bike_id_rental_dates_excl;

DROP INDEX IF EXISTS bookings.idx_reservations_dates;

-- 6. Create new EXCLUDE constraint on rental_period
ALTER TABLE bookings.reservations
  ADD CONSTRAINT reservations_bike_id_rental_period_excl
    EXCLUDE USING gist (
      bike_id WITH =,
      rental_period WITH &&
    ) WHERE (status NOT IN ('cancelled'));

-- 7. Create new indexes for hourly availability queries
CREATE INDEX idx_reservations_period ON bookings.reservations
  USING gist (rental_period)
  WHERE status NOT IN ('cancelled');

-- 8. Drop old column
ALTER TABLE bookings.reservations
  DROP COLUMN rental_dates;

COMMIT;
