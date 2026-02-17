import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import * as waiverService from '../services/waiver.service.js';

export const waiversRouter: IRouter = Router();

const MAX_SIGNATURE_LENGTH = 1_500_000;

const baseWaiverFields = {
  signatureDataUrl: z
    .string()
    .startsWith('data:image/png;base64,')
    .max(MAX_SIGNATURE_LENGTH, 'Signature data too large'),
  fullName: z.string().min(2).max(200).trim(),
  email: z.string().email().max(254).trim().toLowerCase(),
  phone: z
    .string()
    .min(7)
    .max(20)
    .regex(/^[+\d\s()-]+$/, 'Invalid phone format'),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((dob) => {
      const date = new Date(dob);
      const now = new Date();
      return !isNaN(date.getTime()) && date < now;
    }, 'Invalid date of birth'),
  consentElectronic: z.literal(true),
  consentTerms: z.literal(true),
  isMinor: z.boolean().default(false),
  guardianName: z.string().min(2).max(200).trim().optional(),
};

const waiverSchema = z.object({
  reservationId: z.string().uuid(),
  ...baseWaiverFields,
});

const standaloneWaiverSchema = z.object(baseWaiverFields);

// ── POST / (linked to booking) ─────────────────────────────────────────────

waiversRouter.post('/', async (req, res) => {
  const parsed = waiverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const signerIp = req.ip || req.socket.remoteAddress || 'unknown';
  const signerUa = (req.headers['user-agent'] || 'unknown').slice(0, 500);

  const result = await waiverService.submitWaiver(parsed.data, signerIp, signerUa);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.data);
});

// ── POST /standalone ───────────────────────────────────────────────────────

waiversRouter.post('/standalone', async (req, res) => {
  const parsed = standaloneWaiverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const signerIp = req.ip || req.socket.remoteAddress || 'unknown';
  const signerUa = (req.headers['user-agent'] || 'unknown').slice(0, 500);

  const result = await waiverService.submitStandaloneWaiver(parsed.data, signerIp, signerUa);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.data);
});
