import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { adminAuth, truncateBookings, insertTestCustomer, insertTestReservation, closePool } from './setup.js';

beforeAll(async () => {
  await pool.query('SELECT 1');
});

beforeEach(async () => {
  await truncateBookings();
});

afterAll(async () => {
  await truncateBookings();
  await closePool();
});

// Minimal valid PNG signature as base64 for testing
const TINY_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('GET /api/admin/waivers/unlinked', () => {
  it('returns unlinked waivers signed today', async () => {
    // Insert a standalone waiver directly
    const customerId = await insertTestCustomer({ email: 'waiver-test@example.com' });
    await pool.query(
      `INSERT INTO bookings.waivers
         (reservation_id, customer_id, pdf_storage_key, pdf_sha256, signed_at, signer_ip, signer_ua, consent_electronic, consent_terms, is_minor)
       VALUES
         (NULL, $1, 'test/standalone.pdf', 'sha256hash', NOW(), '127.0.0.1', 'test-ua', true, true, false)`,
      [customerId],
    );

    const res = await request(app)
      .get('/api/admin/waivers/unlinked')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(200);
    expect(res.body.waivers).toBeInstanceOf(Array);
    expect(res.body.waivers.length).toBe(1);
    expect(res.body.waivers[0].full_name).toBe('Test Customer');
  });
});

describe('PATCH /api/admin/bookings/:id/link-waivers', () => {
  it('links standalone waivers to a booking', async () => {
    const customerId = await insertTestCustomer({ email: 'link-test@example.com' });
    const reservation = await insertTestReservation({ customerId, status: 'active' });

    // Insert unlinked waiver
    const waiverResult = await pool.query(
      `INSERT INTO bookings.waivers
         (reservation_id, customer_id, pdf_storage_key, pdf_sha256, signed_at, signer_ip, signer_ua, consent_electronic, consent_terms, is_minor)
       VALUES
         (NULL, $1, 'test/link.pdf', 'sha256hash', NOW(), '127.0.0.1', 'test-ua', true, true, false)
       RETURNING id`,
      [customerId],
    );
    const waiverId = waiverResult.rows[0].id;

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/link-waivers`)
      .set('Authorization', adminAuth)
      .send({ waiverIds: [waiverId] });

    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(1);

    // Verify waiver is now linked
    const check = await pool.query(
      `SELECT reservation_id FROM bookings.waivers WHERE id = $1`,
      [waiverId],
    );
    expect(check.rows[0].reservation_id).toBe(reservation.id);
  });

  it('rejects linking to non-existent booking', async () => {
    const res = await request(app)
      .patch('/api/admin/bookings/00000000-0000-0000-0000-000000000000/link-waivers')
      .set('Authorization', adminAuth)
      .send({ waiverIds: ['00000000-0000-0000-0000-000000000001'] });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/waivers', () => {
  it('rejects waiver for non-existent reservation', async () => {
    const res = await request(app)
      .post('/api/waivers')
      .send({
        reservationId: '00000000-0000-0000-0000-000000000000',
        signatureDataUrl: TINY_SIGNATURE,
        fullName: 'Test Person',
        email: 'waiver-reject@example.com',
        phone: '403-555-0100',
        dateOfBirth: '1990-01-01',
        consentElectronic: true,
        consentTerms: true,
        isMinor: false,
      });

    expect(res.status).toBe(404);
  });

  it('rejects invalid waiver data', async () => {
    const res = await request(app)
      .post('/api/waivers')
      .send({
        reservationId: 'not-a-uuid',
        fullName: 'A',
      });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/waivers/standalone', () => {
  it('rejects invalid standalone waiver', async () => {
    const res = await request(app)
      .post('/api/waivers/standalone')
      .send({
        fullName: 'A',
        email: 'not-an-email',
      });

    expect(res.status).toBe(400);
  });
});
