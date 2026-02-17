import { type Router as IRouter, Router } from 'express';
import * as bookingService from '../../services/booking.service.js';
import { walkInSchema } from './schemas.js';

export const walkInRouter: IRouter = Router();

walkInRouter.post('/walk-in', async (req, res) => {
  const parsed = walkInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.createWalkIn(parsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.data);
});
