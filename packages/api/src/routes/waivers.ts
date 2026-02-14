import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { generateWaiverPdf } from '../services/waiver-pdf.js';
import { uploadWaiverPdf } from '../services/storage.js';

export const waiversRouter = Router();

// Signature data URL: must be a PNG, max ~1MB base64 (reasonable for a drawn signature)
const MAX_SIGNATURE_LENGTH = 1_500_000;

const waiverSchema = z.object({
  reservationId: z.string().uuid(),
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
});

/**
 * POST /api/waivers
 * Submits a signed waiver: creates customer record, generates PDF, stores it.
 */
waiversRouter.post('/', async (req, res) => {
  const parsed = waiverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const signerIp = req.ip || req.socket.remoteAddress || 'unknown';
  const signerUa = (req.headers['user-agent'] || 'unknown').slice(0, 500);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify reservation exists and is in hold status
    const reservationCheck = await client.query(
      `SELECT id FROM bookings.reservations WHERE id = $1 AND status = 'hold' AND hold_expires > NOW() FOR UPDATE`,
      [data.reservationId],
    );
    if (reservationCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Reservation not found or hold expired' });
      return;
    }

    // Check if waiver already exists for this reservation (prevent duplicates)
    const existingWaiver = await client.query(
      `SELECT id FROM bookings.waivers WHERE reservation_id = $1`,
      [data.reservationId],
    );
    if (existingWaiver.rowCount && existingWaiver.rowCount > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Waiver already signed for this reservation' });
      return;
    }

    // Create or update customer
    const customerResult = await client.query(
      `
      INSERT INTO bookings.customers (full_name, email, phone, date_of_birth)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        date_of_birth = EXCLUDED.date_of_birth
      RETURNING id
      `,
      [data.fullName, data.email, data.phone, data.dateOfBirth],
    );
    const customerId = customerResult.rows[0].id;

    // Link customer to reservation
    await client.query(
      `UPDATE bookings.reservations SET customer_id = $2, updated_at = NOW() WHERE id = $1`,
      [data.reservationId, customerId],
    );

    // Generate waiver PDF
    const { pdfBuffer, sha256 } = await generateWaiverPdf({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
      reservationId: data.reservationId,
      signatureDataUrl: data.signatureDataUrl,
      signerIp,
      signerUa,
    });

    // Store PDF
    const storageKey = `waivers/${data.reservationId}.pdf`;
    await uploadWaiverPdf(storageKey, pdfBuffer);

    const waiverResult = await client.query(
      `
      INSERT INTO bookings.waivers
        (reservation_id, customer_id, pdf_storage_key, pdf_sha256, signed_at, signer_ip, signer_ua, consent_electronic, consent_terms)
      VALUES ($1, $2, $3, $4, NOW(), $5::inet, $6, $7, $8)
      RETURNING id
      `,
      [
        data.reservationId,
        customerId,
        storageKey,
        sha256,
        signerIp,
        signerUa,
        data.consentElectronic,
        data.consentTerms,
      ],
    );

    await client.query('COMMIT');

    res.status(201).json({
      waiverId: waiverResult.rows[0].id,
      success: true,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Waiver submission error:', err);
    res.status(500).json({ error: 'Failed to submit waiver' });
  } finally {
    client.release();
  }
});
