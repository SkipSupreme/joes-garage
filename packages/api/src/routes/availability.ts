import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';

export const availabilityRouter: IRouter = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z
  .object({
    start: z.string().regex(dateRegex, 'start must be YYYY-MM-DD'),
    end: z.string().regex(dateRegex, 'end must be YYYY-MM-DD'),
  })
  .refine(
    (data) => {
      const start = new Date(data.start);
      const end = new Date(data.end);
      return !isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start;
    },
    { message: 'end must be on or after start' },
  );

/**
 * GET /api/availability?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Returns bikes available for the given date range, with photo URLs and features.
 */
availabilityRouter.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { start, end } = parsed.data;

  try {
    const result = await pool.query(
      `
      SELECT b.id, b.name, b.type, b.size,
             b.price_per_day, b.deposit_amount, b.status,
             m.url AS photo_url, m.alt AS photo_alt,
             COALESCE(
               json_agg(json_build_object('feature', bf.feature) ORDER BY bf._order)
               FILTER (WHERE bf.feature IS NOT NULL),
               '[]'::json
             ) AS features
      FROM bikes b
      LEFT JOIN media m ON m.id = b.photo_id
      LEFT JOIN bikes_features bf ON bf._parent_id = b.id
      WHERE b.status = 'available'
        AND b.id NOT IN (
          SELECT r.bike_id
          FROM bookings.reservations r
          WHERE r.rental_dates && daterange($1::date, $2::date, '[]')
            AND r.status NOT IN ('cancelled')
        )
      GROUP BY b.id, b.name, b.type, b.size,
               b.price_per_day, b.deposit_amount, b.status,
               m.url, m.alt
      ORDER BY b.type, b.name
      `,
      [start, end],
    );

    res.json({ bikes: result.rows });
  } catch (err) {
    console.error('Availability query error:', err);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});
