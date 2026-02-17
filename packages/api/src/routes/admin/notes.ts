import { type Router as IRouter, Router } from 'express';
import * as bookingService from '../../services/booking.service.js';
import { uuidParam, noteSchema } from './schemas.js';

export const notesRouter: IRouter = Router();

notesRouter.post('/bookings/:id/note', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const result = await bookingService.addNote(idParsed.data, parsed.data.text);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.data);
});
