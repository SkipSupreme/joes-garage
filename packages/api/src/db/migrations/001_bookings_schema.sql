-- Joe's Garage Booking System Schema
-- Requires: PostgreSQL 16+ with btree_gist extension

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS bookings;

-- Customers
CREATE TABLE bookings.customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  date_of_birth DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Reservations
CREATE TABLE bookings.reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID REFERENCES bookings.customers(id),
  bike_id         INTEGER NOT NULL,
  rental_dates    DATERANGE NOT NULL,
  status          TEXT DEFAULT 'hold',
  hold_expires    TIMESTAMPTZ,
  payment_token   TEXT,
  moneris_txn     TEXT,
  total_amount    NUMERIC(10,2),
  deposit_amount  NUMERIC(10,2),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent double-booking at the database level
  EXCLUDE USING gist (
    bike_id WITH =,
    rental_dates WITH &&
  ) WHERE (status NOT IN ('cancelled'))
);

-- Waiver records
CREATE TABLE bookings.waivers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id      UUID REFERENCES bookings.reservations(id),
  customer_id         UUID REFERENCES bookings.customers(id),
  pdf_storage_key     TEXT NOT NULL,
  pdf_sha256          TEXT NOT NULL,
  signed_at           TIMESTAMPTZ NOT NULL,
  signer_ip           INET,
  signer_ua           TEXT,
  consent_electronic  BOOLEAN NOT NULL DEFAULT true,
  consent_terms       BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations tracking table (for the custom migrator)
CREATE TABLE IF NOT EXISTS bookings._migrations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for availability queries
CREATE INDEX idx_reservations_dates ON bookings.reservations
  USING gist (rental_dates)
  WHERE status NOT IN ('cancelled');

CREATE INDEX idx_reservations_bike ON bookings.reservations (bike_id)
  WHERE status NOT IN ('cancelled');

CREATE INDEX idx_reservations_status ON bookings.reservations (status);

CREATE INDEX idx_customers_email ON bookings.customers (email);
