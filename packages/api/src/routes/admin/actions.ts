import { type Router as IRouter, Router } from 'express';
import * as bookingService from '../../services/booking.service.js';
import { uuidParam, checkOutSchema, checkInSchema, cancelSchema, extendSchema } from './schemas.js';

export const actionsRouter: IRouter = Router();

actionsRouter.patch('/bookings/:id/check-out', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = checkOutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.checkOut(idParsed.data, parsed.data.itemIds);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

actionsRouter.patch('/bookings/:id/check-in', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = checkInSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.checkIn(idParsed.data, parsed.data.itemIds, parsed.data.notes);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

actionsRouter.patch('/bookings/:id/cancel', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = cancelSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.cancelBooking(idParsed.data, parsed.data.reason);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

actionsRouter.patch('/bookings/:id/extend', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = extendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.extendBooking(idParsed.data, parsed.data.newReturnTime);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

actionsRouter.post('/bookings/:id/complete', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const result = await bookingService.completeBooking(idParsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});
