import { Router } from 'express';
import { z } from 'zod';
import { sendContactNotification } from '../services/email.js';

export const contactRouter = Router();

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
 */
contactRouter.post('/', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { name, email, phone, subject, message } = parsed.data;

  // Save to Payload CMS Messages collection
  try {
    const cmsResponse = await fetch(`${PAYLOAD_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, subject, message }),
    });

    if (!cmsResponse.ok) {
      console.error('CMS save failed:', cmsResponse.status, await cmsResponse.text());
      // Continue to send email even if CMS save fails
    }
  } catch (err) {
    console.error('CMS save error:', err);
    // Continue — email notification is more important than CMS storage
  }

  // Send email notification to Joe
  try {
    await sendContactNotification({ name, email, phone, subject, message });
  } catch (err) {
    console.error('Contact email error:', err);
    // Still return success — the message was saved to CMS
  }

  res.json({ status: 'ok' });
});
