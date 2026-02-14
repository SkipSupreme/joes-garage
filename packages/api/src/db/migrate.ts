import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, 'migrations');

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings._migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const applied = await client.query('SELECT name FROM bookings._migrations ORDER BY id');
    const appliedNames = new Set(applied.rows.map((r: { name: string }) => r.name));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`  skip: ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`  apply: ${file}`);

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO bookings._migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    }

    console.log('Migrations complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
