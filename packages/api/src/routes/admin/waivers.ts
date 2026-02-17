import { type Router as IRouter, Router } from 'express';
import * as waiverService from '../../services/waiver.service.js';
import { uuidParam, linkWaiversSchema } from './schemas.js';

export const waiversRouter: IRouter = Router();

waiversRouter.get('/waivers/unlinked', async (_req, res) => {
  const result = await waiverService.getUnlinkedWaivers();
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

waiversRouter.patch('/bookings/:id/link-waivers', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = linkWaiversSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await waiverService.linkWaivers(idParsed.data, parsed.data.waiverIds);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.data);
});

waiversRouter.get('/bookings/:id/waiver', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }

  const result = await waiverService.getWaiverForBooking(idParsed.data);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }

  const { pdfBuffer, safeName } = result.data;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="waiver-${safeName}.pdf"`);
  res.send(pdfBuffer);
});
