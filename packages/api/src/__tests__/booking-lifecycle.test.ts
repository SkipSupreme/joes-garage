import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import {
  adminAuth,
  truncateBookings,
  insertTestCustomer,
  insertTestReservation,
  insertTestItem,
  closePool,
} from './setup.js';

beforeAll(async () => {
  // Verify DB connection
  await pool.query('SELECT 1');
});

beforeEach(async () => {
  await truncateBookings();
});

afterAll(async () => {
  await truncateBookings();
  await closePool();
});

// ── Dashboard ────────────────────────────────────────────────────────────

describe('GET /api/admin/dashboard', () => {
  it('returns dashboard stats', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stats');
    expect(res.body.stats).toHaveProperty('active_rentals');
    expect(res.body.stats).toHaveProperty('total_fleet');
    expect(res.body).toHaveProperty('alerts');
  });

  it('requires admin auth', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });
});

// ── Booking list ─────────────────────────────────────────────────────────

describe('GET /api/admin/bookings', () => {
  it('returns paginated bookings', async () => {
    const customerId = await insertTestCustomer();
    await insertTestReservation({ customerId, status: 'paid' });

    const res = await request(app)
      .get('/api/admin/bookings')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.page).toBe(1);
  });

  it('filters by status', async () => {
    const customerId = await insertTestCustomer();
    await insertTestReservation({ customerId, status: 'paid' });
    await insertTestReservation({ customerId, status: 'active' });

    const res = await request(app)
      .get('/api/admin/bookings?status=paid')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.bookings[0].status).toBe('paid');
  });
});

// ── Booking detail ───────────────────────────────────────────────────────

describe('GET /api/admin/bookings/:id', () => {
  it('returns full booking detail with items', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'active' });
    await insertTestItem(reservation.id, 1, { checkedOutAt: new Date().toISOString() });

    const res = await request(app)
      .get(`/api/admin/bookings/${reservation.id}`)
      .set('Authorization', adminAuth);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(reservation.id);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].bike_id).toBe(1);
  });

  it('returns 404 for non-existent booking', async () => {
    const res = await request(app)
      .get('/api/admin/bookings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app)
      .get('/api/admin/bookings/not-a-uuid')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(400);
  });
});

// ── Check-out ────────────────────────────────────────────────────────────

describe('PATCH /api/admin/bookings/:id/check-out', () => {
  it('checks out all items and sets status to active', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'paid' });
    await insertTestItem(reservation.id, 1);
    await insertTestItem(reservation.id, 2);

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/check-out`)
      .set('Authorization', adminAuth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.checked_out).toBe(2);
  });

  it('cannot check out from hold status', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'hold' });
    await insertTestItem(reservation.id, 1);

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/check-out`)
      .set('Authorization', adminAuth)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('hold');
  });

  it('checks out specific items only', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'paid' });
    const item1 = await insertTestItem(reservation.id, 1);
    await insertTestItem(reservation.id, 2);

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/check-out`)
      .set('Authorization', adminAuth)
      .send({ itemIds: [item1] });

    expect(res.status).toBe(200);
    expect(res.body.checked_out).toBe(1);
  });
});

// ── Check-in ─────────────────────────────────────────────────────────────

describe('PATCH /api/admin/bookings/:id/check-in', () => {
  it('partial check-in keeps status active', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'active' });
    const item1 = await insertTestItem(reservation.id, 1, { checkedOutAt: new Date().toISOString() });
    await insertTestItem(reservation.id, 2, { checkedOutAt: new Date().toISOString() });

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/check-in`)
      .set('Authorization', adminAuth)
      .send({ itemIds: [item1] });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.checked_in).toBe(1);
    expect(res.body.all_returned).toBe(false);
  });

  it('full check-in auto-completes booking', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'active' });
    await insertTestItem(reservation.id, 1, { checkedOutAt: new Date().toISOString() });

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/check-in`)
      .set('Authorization', adminAuth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.all_returned).toBe(true);
  });

  it('cannot check in from hold status', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'hold' });
    await insertTestItem(reservation.id, 1);

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/check-in`)
      .set('Authorization', adminAuth)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── Cancel ───────────────────────────────────────────────────────────────

describe('PATCH /api/admin/bookings/:id/cancel', () => {
  it('cancels a hold booking', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'hold' });

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/cancel`)
      .set('Authorization', adminAuth)
      .send({ reason: 'Customer requested' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('cannot cancel an active booking', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'active' });

    const res = await request(app)
      .patch(`/api/admin/bookings/${reservation.id}/cancel`)
      .set('Authorization', adminAuth)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── Walk-in ──────────────────────────────────────────────────────────────

describe('POST /api/admin/walk-in', () => {
  it('creates an active booking with checked_out_at', async () => {
    const res = await request(app)
      .post('/api/admin/walk-in')
      .set('Authorization', adminAuth)
      .send({
        bikes: [{ bikeId: 1 }],
        duration: '2h',
        customer: {
          fullName: 'Walk In Customer',
          phone: '403-555-0199',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.reservationId).toBeTruthy();
    expect(res.body.bookingRef).toBeTruthy();
    expect(res.body.waiverUrl).toContain('/waiver/');

    // Verify items are checked out in DB
    const items = await pool.query(
      `SELECT checked_out_at FROM bookings.reservation_items WHERE reservation_id = $1`,
      [res.body.reservationId],
    );
    expect(items.rows.length).toBeGreaterThan(0);
    expect(items.rows[0].checked_out_at).toBeTruthy();
  });
});

// ── Notes ────────────────────────────────────────────────────────────────

describe('POST /api/admin/bookings/:id/note', () => {
  it('adds a note to a booking', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'active' });

    const res = await request(app)
      .post(`/api/admin/bookings/${reservation.id}/note`)
      .set('Authorization', adminAuth)
      .send({ text: 'Test note' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });
});

// ── Complete ─────────────────────────────────────────────────────────────

describe('POST /api/admin/bookings/:id/complete', () => {
  it('marks an active booking as completed', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'active' });

    const res = await request(app)
      .post(`/api/admin/bookings/${reservation.id}/complete`)
      .set('Authorization', adminAuth);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('rejects completing a cancelled booking', async () => {
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({ customerId, status: 'cancelled' });

    const res = await request(app)
      .post(`/api/admin/bookings/${reservation.id}/complete`)
      .set('Authorization', adminAuth);

    expect(res.status).toBe(404);
  });
});

// ── Fleet ────────────────────────────────────────────────────────────────

describe('GET /api/admin/fleet', () => {
  it('returns fleet status grouped by type', async () => {
    const res = await request(app)
      .get('/api/admin/fleet')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(200);
    expect(res.body.fleet).toBeInstanceOf(Array);
    expect(res.body.fleet.length).toBeGreaterThan(0);
    expect(res.body.fleet[0]).toHaveProperty('type');
    expect(res.body.fleet[0]).toHaveProperty('total');
    expect(res.body.fleet[0]).toHaveProperty('available');
  });
});

// ── EXCLUDE constraint (double-booking prevention) ───────────────────────

describe('EXCLUDE constraint', () => {
  it('prevents double-booking the same bike for overlapping periods', async () => {
    const customerId = await insertTestCustomer();

    // First booking takes bike 1 for the next 2 hours
    const res1 = await insertTestReservation({ customerId, status: 'paid' });
    await insertTestItem(res1.id, 1);

    // Second booking tries to book bike 1 for the same period
    const res2 = await insertTestReservation({ customerId, status: 'paid' });

    // The EXCLUDE constraint should reject this at the DB level
    await expect(insertTestItem(res2.id, 1)).rejects.toThrow();
  });
});
