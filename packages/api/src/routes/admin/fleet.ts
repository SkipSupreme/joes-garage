import { type Router as IRouter, Router } from 'express';
import * as fleetService from '../../services/fleet.service.js';

export const fleetRouter: IRouter = Router();

fleetRouter.get('/fleet', async (_req, res) => {
  const result = await fleetService.getFleetStatus();
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});
