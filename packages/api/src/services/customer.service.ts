import type { DbClient } from '../types/db.js';

/**
 * Upsert a customer record. If the email already exists, updates name/phone/dob.
 * Returns the customer ID.
 */
export async function upsertCustomer(
  client: DbClient,
  data: {
    fullName: string;
    email: string;
    phone: string;
    dateOfBirth?: string | null;
  },
): Promise<string> {
  const result = await client.query(
    `INSERT INTO bookings.customers (full_name, email, phone, date_of_birth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       date_of_birth = COALESCE(EXCLUDED.date_of_birth, bookings.customers.date_of_birth)
     RETURNING id`,
    [data.fullName, data.email, data.phone, data.dateOfBirth ?? null],
  );
  return result.rows[0].id;
}
