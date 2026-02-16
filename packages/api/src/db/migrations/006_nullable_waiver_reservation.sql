-- Migration 006: Allow standalone waivers (no reservation required)
-- Enables the QR walk-up waiver flow where customers sign before a booking exists.

ALTER TABLE bookings.waivers
  ALTER COLUMN reservation_id DROP NOT NULL;

-- Partial index for efficiently querying today's unlinked waivers
CREATE INDEX IF NOT EXISTS idx_waivers_unlinked
  ON bookings.waivers (signed_at DESC)
  WHERE reservation_id IS NULL;
