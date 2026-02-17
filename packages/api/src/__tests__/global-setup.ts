/**
 * Vitest global setup — creates a dedicated test database so tests
 * never touch the development/production data.
 *
 * Runs ONCE before the first test file.  The companion global-teardown
 * drops the test database after all tests complete.
 */
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEST_DB = 'joes_garage_test';
const BASE_URL = 'postgresql://postgres:postgres@localhost:5434';
const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, '..', 'db', 'migrations');

export default async function globalSetup() {
  // ── 1. Connect to the default 'postgres' database to create the test DB ──
  const admin = new pg.Client({ connectionString: `${BASE_URL}/postgres` });
  await admin.connect();

  // Drop + recreate for a clean slate each run
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  // ── 2. Run all migrations against the test DB ────────────────────────────
  const testPool = new pg.Pool({ connectionString: `${BASE_URL}/${TEST_DB}` });
  const client = await testPool.connect();

  try {
    // ── Extensions required by migrations (gen_random_bytes for booking_ref) ──
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE EXTENSION IF NOT EXISTS btree_gist');

    // ── Bikes table + enums (lives in public schema, referenced by bookings) ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE enum_bikes_type AS ENUM ('city','cruiser','mountain','road','hybrid','coaster','kids','trail-a-bike');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE TYPE enum_bikes_size AS ENUM ('small','medium','large','kids');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE TYPE enum_bikes_status AS ENUM ('available','in-repair','retired');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS bikes (
        id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL,
        type enum_bikes_type NOT NULL,
        size enum_bikes_size,
        price_per_day NUMERIC NOT NULL,
        deposit_amount NUMERIC NOT NULL,
        photo_id INTEGER NOT NULL DEFAULT 0,
        description JSONB,
        status enum_bikes_status NOT NULL DEFAULT 'available',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        price2h NUMERIC NOT NULL,
        price4h NUMERIC NOT NULL,
        price8h NUMERIC NOT NULL
      );

      -- Media table (Payload CMS manages this; availability query JOINs for photo URLs)
      CREATE TABLE IF NOT EXISTS media (
        id SERIAL PRIMARY KEY,
        alt VARCHAR NOT NULL DEFAULT '',
        url VARCHAR,
        filename VARCHAR,
        mime_type VARCHAR,
        filesize NUMERIC,
        width NUMERIC,
        height NUMERIC,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO media (id, alt, filename) VALUES
        (1, 'city bike', 'city-bike.jpg'),
        (2, 'mountain bike', 'mountain-bike.jpg');

      -- Seed test bikes (3 city + 2 mountain = 5 total, enough for all tests)
      INSERT INTO bikes (name, type, size, price_per_day, deposit_amount, photo_id, price2h, price4h, price8h)
      VALUES
        ('Test City 1',     'city',     'small',  25, 200, 1, 25, 40, 60),
        ('Test City 2',     'city',     'medium', 25, 200, 1, 25, 40, 60),
        ('Test City 3',     'city',     'large',  25, 200, 1, 25, 40, 60),
        ('Test Mountain 1', 'mountain', 'medium', 45, 200, 2, 45, 65, 90),
        ('Test Mountain 2', 'mountain', 'large',  45, 200, 2, 45, 65, 90);
    `);

    // ── Bookings schema + migrations ──────────────────────────────────────
    await client.query('CREATE SCHEMA IF NOT EXISTS bookings');

    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings._migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO bookings._migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await testPool.end();
  }

  // ── 3. Set DATABASE_URL so pool.ts connects to the test DB ───────────────
  process.env.DATABASE_URL = `${BASE_URL}/${TEST_DB}`;

  // Return teardown function that drops the test database
  return async () => {
    const teardownClient = new pg.Client({ connectionString: `${BASE_URL}/postgres` });
    await teardownClient.connect();
    await teardownClient.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()
    `);
    await teardownClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await teardownClient.end();
  };
}
