import { type Router as IRouter, Router } from 'express';
import * as bookingService from '../../services/booking.service.js';
import { uuidParam, bookingsQuerySchema } from './schemas.js';

export const bookingsRouter: IRouter = Router();

bookingsRouter.get('/bookings', async (req, res) => {
  const parsed = bookingsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }

  const result = await bookingService.listBookings(parsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

bookingsRouter.get('/bookings/:id', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const result = await bookingService.getBookingDetail(idParsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});
