import { type Router as IRouter, Router } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import * as bookingService from '../services/booking.service.js';

export const bookingsRouter: IRouter = Router();

const MAX_RENTAL_DAYS = 30;

const BOOKING_HMAC_SECRET = process.env.BOOKING_HMAC_SECRET || 'dev-booking-hmac-secret';

if (!process.env.BOOKING_HMAC_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('BOOKING_HMAC_SECRET environment variable is required in production');
}

/** Generate a short HMAC token for a booking ref (used in confirmation URLs) */
export function generateBookingToken(bookingRef: string): string {
  return createHmac('sha256', BOOKING_HMAC_SECRET)
    .update(bookingRef.toUpperCase())
    .digest('hex')
    .slice(0, 12);
}

const holdSchema = z
  .object({
    bikes: z.array(z.object({ bikeId: z.number().int().positive() })).min(1).max(10),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    duration: z.enum(['2h', '4h', '8h', 'multi-day']),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (data) => {
      if (data.duration === 'multi-day') return !!data.endDate;
      if (data.duration === '8h') return true;
      return !!data.startTime;
    },
    { message: '2h/4h rentals require startTime; multi-day requires endDate' },
  )
  .refine(
    (data) => {
      const start = new Date(data.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start < today) return false;

      if (data.duration === 'multi-day' && data.endDate) {
        const end = new Date(data.endDate);
        if (end < start) return false;
        const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > MAX_RENTAL_DAYS) return false;
      }
      return true;
    },
    { message: `Invalid dates. Start must be today or later. Max rental: ${MAX_RENTAL_DAYS} days.` },
  );

const paySchema = z.object({
  reservationId: z.string().uuid(),
  monerisToken: z.string().min(1).max(500),
});

const uuidParam = z.string().uuid();

// ── POST /hold ─────────────────────────────────────────────────────────────

bookingsRouter.post('/hold', async (req, res) => {
  // Backward compat: normalize old single-bike format
  if (req.body.bikeId && !req.body.bikes) {
    req.body.bikes = [{ bikeId: req.body.bikeId }];
    delete req.body.bikeId;
  }

  const parsed = holdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.createHold(parsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.data);
});

// ── POST /pay ──────────────────────────────────────────────────────────────

bookingsRouter.post('/pay', async (req, res) => {
  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.processPayment(parsed.data.reservationId, parsed.data.monerisToken);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

// ── GET /:id ───────────────────────────────────────────────────────────────

bookingsRouter.get('/:id', async (req, res) => {
  const param = req.params.id;
  const isUuid = uuidParam.safeParse(param).success;
  const isRef = /^[A-Z0-9]{6}$/i.test(param);

  if (!isUuid && !isRef) {
    res.status(400).json({ error: 'Invalid booking ID or reference' });
    return;
  }

  // HMAC token validation for booking ref lookups (prevents enumeration)
  if (isRef) {
    const token = req.query.token as string | undefined;
    const expected = generateBookingToken(param.toUpperCase());
    const valid = token && token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!valid) {
      res.status(403).json({ error: 'Invalid or missing booking token' });
      return;
    }
  }

  const result = await bookingService.getPublicBooking(param, isUuid);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});
