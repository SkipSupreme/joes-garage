import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';

export const availabilityRouter: IRouter = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}$/;

const TIMEZONE = 'America/Edmonton';
const DURATION_HOURS: Record<string, number> = { '2h': 2, '4h': 4, '8h': 8 };
const CMS_URL = process.env.CMS_URL || 'http://localhost:3003';

/**
 * Map duration type → price column in the bikes table.
 */
const PRICE_COLUMN: Record<string, string> = {
  '2h': 'price2h',
  '4h': 'price4h',
  '8h': 'price8h',
  'multi-day': 'price_per_day',
};

const querySchema = z
  .object({
    date: z.string().regex(dateRegex, 'date must be YYYY-MM-DD'),
    duration: z.enum(['2h', '4h', '8h', 'multi-day']),
    startTime: z.string().regex(timeRegex, 'startTime must be HH:MM').optional(),
    endDate: z.string().regex(dateRegex, 'endDate must be YYYY-MM-DD').optional(),
  })
  .refine(
    (data) => {
      if (data.duration === 'multi-day') return !!data.endDate;
      if (data.duration === '8h') return true; // Full Day uses fixed shop hours
      return !!data.startTime;
    },
    { message: '2h/4h rentals require startTime; multi-day requires endDate' },
  );

/**
 * GET /api/availability?date=YYYY-MM-DD&duration=4h&startTime=10:00
 * GET /api/availability?date=YYYY-MM-DD&duration=multi-day&endDate=YYYY-MM-DD
 *
 * Returns bikes available for the given period, with the correct rental price.
 */
availabilityRouter.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { date, duration, startTime, endDate } = parsed.data;

  // Build TSTZRANGE bounds
  let rangeStart: string;
  let rangeEnd: string;

  if (duration === 'multi-day') {
    // Multi-day: full calendar days
    rangeStart = `${date} 00:00`;
    // endDate upper bound is the next day at midnight (exclusive end)
    const end = new Date(endDate!);
    end.setDate(end.getDate() + 1);
    rangeEnd = `${end.toISOString().split('T')[0]} 00:00`;
  } else if (duration === '8h') {
    // Full Day: fixed shop hours 9:30 AM – 6:00 PM
    rangeStart = `${date} 09:30`;
    rangeEnd = `${date} 18:00`;
  } else {
    // Hourly (2h/4h): date + startTime → date + startTime + duration hours
    rangeStart = `${date} ${startTime}`;
    const hours = DURATION_HOURS[duration];
    const [h, m] = startTime!.split(':').map(Number);
    const endH = h + hours;
    if (endH >= 24) {
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      rangeEnd = `${nextDate.toISOString().split('T')[0]} ${String(endH - 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    } else {
      rangeEnd = `${date} ${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  const priceCol = PRICE_COLUMN[duration];

  try {
    // Group identical bikes (same name + type + size) and return count + bike IDs
    const result = await pool.query(
      `
      WITH available AS (
        SELECT b.id, b.name, b.type, b.size,
               b.price2h, b.price4h, b.price8h, b.price_per_day,
               b.deposit_amount,
               b.${priceCol} AS rental_price,
               m.url AS photo_url, m.alt AS photo_alt
        FROM bikes b
        LEFT JOIN media m ON m.id = b.photo_id
        WHERE b.status = 'available'
          AND NOT EXISTS (
            SELECT 1
            FROM bookings.reservation_items ri
            JOIN bookings.reservations r ON r.id = ri.reservation_id
            WHERE ri.bike_id = b.id
              AND ri.rental_period && tstzrange(
                ($1::timestamp AT TIME ZONE $3),
                ($2::timestamp AT TIME ZONE $3),
                '[)'
              )
              AND r.status NOT IN ('cancelled')
          )
      )
      SELECT name, type, size,
             (array_agg(id ORDER BY id))[1] AS id,
             json_agg(id ORDER BY id) AS bike_ids,
             count(*)::int AS available_count,
             min(rental_price) AS rental_price,
             min(price2h) AS price2h,
             min(price4h) AS price4h,
             min(price8h) AS price8h,
             min(price_per_day) AS price_per_day,
             min(deposit_amount) AS deposit_amount,
             (array_agg(photo_url))[1] AS photo_url,
             (array_agg(photo_alt))[1] AS photo_alt
      FROM available
      GROUP BY name, type, size
      ORDER BY type, name, size
      `,
      [rangeStart, rangeEnd, TIMEZONE],
    );

    // Prefix photo URLs with CMS base URL
    const bikes = result.rows.map((row) => ({
      ...row,
      photo_url: row.photo_url ? `${CMS_URL}${row.photo_url}` : null,
    }));

    res.json({ bikes });
  } catch (err) {
    console.error('Availability query error:', err);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});
