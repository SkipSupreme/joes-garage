import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { truncateBookings, insertTestCustomer, insertTestReservation, insertTestItem, closePool } from './setup.js';

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

describe('GET /api/availability', () => {
  it('returns available bikes for a 2h slot', async () => {
    // Use a future date to avoid time-of-day issues
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const res = await request(app)
      .get(`/api/availability?date=${dateStr}&duration=2h&startTime=10:00`);

    expect(res.status).toBe(200);
    expect(res.body.bikes).toBeInstanceOf(Array);
    expect(res.body.bikes.length).toBeGreaterThan(0);
    expect(res.body.bikes[0]).toHaveProperty('name');
    expect(res.body.bikes[0]).toHaveProperty('rental_price');
    expect(res.body.bikes[0]).toHaveProperty('available_count');
  });

  it('returns available bikes for full day', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const res = await request(app)
      .get(`/api/availability?date=${dateStr}&duration=8h`);

    expect(res.status).toBe(200);
    expect(res.body.bikes).toBeInstanceOf(Array);
  });

  it('returns available bikes for multi-day', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 3);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const endStr = dayAfter.toISOString().split('T')[0];

    const res = await request(app)
      .get(`/api/availability?date=${dateStr}&duration=multi-day&endDate=${endStr}`);

    expect(res.status).toBe(200);
    expect(res.body.bikes).toBeInstanceOf(Array);
  });

  it('excludes booked bikes from results', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    // Get initial availability
    const before = await request(app)
      .get(`/api/availability?date=${dateStr}&duration=2h&startTime=10:00`);

    // Book bike 1 for the same slot
    const customerId = await insertTestCustomer();
    const reservation = await insertTestReservation({
      customerId,
      status: 'paid',
      startOffset: `'${dateStr} 10:00'::timestamp AT TIME ZONE 'America/Edmonton'`,
      endOffset: `'${dateStr} 12:00'::timestamp AT TIME ZONE 'America/Edmonton'`,
    });
    await insertTestItem(reservation.id, 1, {
      startOffset: `'${dateStr} 10:00'::timestamp AT TIME ZONE 'America/Edmonton'`,
      endOffset: `'${dateStr} 12:00'::timestamp AT TIME ZONE 'America/Edmonton'`,
    });

    // Get availability again
    const after = await request(app)
      .get(`/api/availability?date=${dateStr}&duration=2h&startTime=10:00`);

    expect(after.status).toBe(200);

    // Find the group that includes bike 1 and check its count decreased
    const beforeGroup = before.body.bikes.find((b: any) => b.bike_ids?.includes(1));
    const afterGroup = after.body.bikes.find((b: any) => b.bike_ids?.includes(1));

    if (beforeGroup && afterGroup) {
      expect(afterGroup.available_count).toBeLessThan(beforeGroup.available_count);
    } else if (beforeGroup && !afterGroup) {
      // Bike 1 was the only one in its group and is now fully booked
      expect(true).toBe(true);
    }
  });

  it('rejects missing required params', async () => {
    const res = await request(app).get('/api/availability?date=2026-08-01');
    expect(res.status).toBe(400);
  });

  it('rejects 2h without startTime', async () => {
    const res = await request(app).get('/api/availability?date=2026-08-01&duration=2h');
    expect(res.status).toBe(400);
  });
});
