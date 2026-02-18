import { type Router as IRouter, Router } from 'express';
import { z } from 'zod';
import { sendContactNotification } from '../services/email.js';
import { logger } from '../lib/logger.js';

export const contactRouter: IRouter = Router();

const PAYLOAD_URL = process.env.PAYLOAD_URL || 'http://localhost:3003';

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(300),
  phone: z.string().max(30).optional().default(''),
  subject: z.enum(['repair', 'rental', 'general', 'other']),
  message: z.string().min(1).max(5000),
});

/**
 * POST /api/contact
 * Saves the message to Payload CMS and emails Joe.
 * At least one delivery channel (CMS or email) must succeed.
 */
contactRouter.post('/', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { name, email, phone, subject, message } = parsed.data;

  let cmsSaved = false;
  let emailSent = false;

  // Save to Payload CMS Messages collection
  try {
    const cmsResponse = await fetch(`${PAYLOAD_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, subject, message }),
    });

    if (cmsResponse.ok) {
      cmsSaved = true;
    } else {
      logger.error({ status: cmsResponse.status }, 'CMS save failed');
    }
  } catch (err) {
    logger.error({ err }, 'CMS save error');
  }

  // Send email notification to Joe
  try {
    await sendContactNotification({ name, email, phone, subject, message });
    emailSent = true;
  } catch (err) {
    logger.error({ err }, 'Contact email error');
  }

  if (!cmsSaved && !emailSent) {
    res.status(500).json({ error: 'Unable to deliver your message. Please call us instead.' });
    return;
  }

  res.json({ status: 'ok' });
});
