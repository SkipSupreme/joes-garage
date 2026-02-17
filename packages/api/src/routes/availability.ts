import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import * as fleetService from '../services/fleet.service.js';

export const availabilityRouter: IRouter = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}$/;

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
      if (data.duration === '8h') return true;
      return !!data.startTime;
    },
    { message: '2h/4h rentals require startTime; multi-day requires endDate' },
  );

availabilityRouter.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { date, duration, startTime, endDate } = parsed.data;
  const result = await fleetService.checkAvailability(date, duration, startTime, endDate);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});
