import { type Router as IRouter, Router } from 'express';
import * as bookingService from '../../services/booking.service.js';

export const dashboardRouter: IRouter = Router();

dashboardRouter.get('/dashboard', async (_req, res) => {
  const result = await bookingService.getDashboard();
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});
