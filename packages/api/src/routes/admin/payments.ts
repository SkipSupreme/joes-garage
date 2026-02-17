import { type Router as IRouter, Router } from 'express';
import * as bookingService from '../../services/booking.service.js';
import { uuidParam } from './schemas.js';

export const paymentsRouter: IRouter = Router();

paymentsRouter.post('/bookings/:id/capture', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const result = await bookingService.capturePayment(idParsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

paymentsRouter.post('/bookings/:id/void', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const result = await bookingService.voidPayment(idParsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});
