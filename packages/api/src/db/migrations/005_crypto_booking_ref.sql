-- Migration 005: Use cryptographically secure random for booking refs
-- PostgreSQL's random() is not cryptographic; gen_random_bytes() uses /dev/urandom

CREATE OR REPLACE FUNCTION bookings.generate_booking_ref()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  ref TEXT := '';
  bytes BYTEA;
  i INT;
BEGIN
  bytes := gen_random_bytes(6);
  FOR i IN 0..5 LOOP
    ref := ref || substr(chars, (get_byte(bytes, i) % 30) + 1, 1);
  END LOOP;
  RETURN ref;
END;
$$ LANGUAGE plpgsql;
