-- Migration 004: Add short human-readable booking reference codes
-- Instead of UUID waiver URLs, use codes like JG-A3F2 that customers can type

-- Function to generate a random 6-char alphanumeric code
-- Uses 23456789ABCDEFGHJKMNPQRSTUVWXYZ (30 chars, no 0/O/1/I/L to avoid confusion)
CREATE OR REPLACE FUNCTION bookings.generate_booking_ref()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  ref TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    ref := ref || substr(chars, floor(random() * 30 + 1)::int, 1);
  END LOOP;
  RETURN ref;
END;
$$ LANGUAGE plpgsql;

-- Add booking_ref column
ALTER TABLE bookings.reservations
  ADD COLUMN booking_ref TEXT;

-- Generate refs for existing rows
UPDATE bookings.reservations
SET booking_ref = bookings.generate_booking_ref()
WHERE booking_ref IS NULL;

-- Make it NOT NULL with a unique constraint
ALTER TABLE bookings.reservations
  ALTER COLUMN booking_ref SET NOT NULL,
  ALTER COLUMN booking_ref SET DEFAULT bookings.generate_booking_ref();

CREATE UNIQUE INDEX idx_reservations_booking_ref ON bookings.reservations (booking_ref);
