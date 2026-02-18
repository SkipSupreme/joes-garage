import pool from '../db/pool.js';
import { upsertCustomer } from './customer.service.js';
import { generateWaiverPdf } from './waiver-pdf.js';
import { uploadWaiverPdf, getWaiverPdf } from './storage.js';
import { getWaiverTextFromCMS } from './cms.js';
import { logger } from '../lib/logger.js';
import type { ServiceResult } from '../types/db.js';
import { ok, fail } from '../types/db.js';

// ── Submit waiver (linked to booking) ──────────────────────────────────────

export interface WaiverInput {
  reservationId: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  signatureDataUrl: string;
  consentElectronic: boolean;
  consentTerms: boolean;
  isMinor: boolean;
  guardianName?: string;
}

export async function submitWaiver(
  data: WaiverInput,
  signerIp: string,
  signerUa: string,
): Promise<ServiceResult<{ waiverId: string; success: boolean }>> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reservationCheck = await client.query(
      `SELECT id FROM bookings.reservations
       WHERE id = $1
         AND (
           (status = 'hold' AND hold_expires > NOW())
           OR status IN ('paid', 'active')
         )
       FOR UPDATE`,
      [data.reservationId],
    );
    if (reservationCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return fail(404, 'Reservation not found or no longer accepting waivers');
    }

    const customerId = await upsertCustomer(client, {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
    });

    await client.query(
      `UPDATE bookings.reservations SET customer_id = $2, updated_at = NOW() WHERE id = $1`,
      [data.reservationId, customerId],
    );

    const waiverText = await getWaiverTextFromCMS();

    const { pdfBuffer, sha256 } = await generateWaiverPdf({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
      reservationId: data.reservationId,
      signatureDataUrl: data.signatureDataUrl,
      signerIp,
      signerUa,
      waiverText: waiverText || undefined,
    });

    const storageKey = `waivers/${data.reservationId}-${customerId}.pdf`;
    await uploadWaiverPdf(storageKey, pdfBuffer);

    let guardianCustomerId: string | null = null;
    if (data.isMinor && data.guardianName) {
      const guardianResult = await client.query(
        `SELECT c.id FROM bookings.customers c
         JOIN bookings.waivers w ON w.customer_id = c.id
         WHERE w.reservation_id = $1 AND c.full_name = $2
         LIMIT 1`,
        [data.reservationId, data.guardianName],
      );
      if (guardianResult.rowCount && guardianResult.rowCount > 0) {
        guardianCustomerId = guardianResult.rows[0].id;
      }
    }

    const waiverResult = await client.query(
      `INSERT INTO bookings.waivers
        (reservation_id, customer_id, pdf_storage_key, pdf_sha256, signed_at, signer_ip, signer_ua, consent_electronic, consent_terms, is_minor, guardian_customer_id)
      VALUES ($1, $2, $3, $4, NOW(), $5::inet, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        data.reservationId,
        customerId,
        storageKey,
        sha256,
        signerIp,
        signerUa,
        data.consentElectronic,
        data.consentTerms,
        data.isMinor,
        guardianCustomerId,
      ],
    );

    await client.query('COMMIT');

    return ok({ waiverId: waiverResult.rows[0].id, success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Waiver submission error');
    return fail(500, 'Failed to submit waiver');
  } finally {
    client.release();
  }
}

// ── Submit standalone waiver (no booking) ──────────────────────────────────

export interface StandaloneWaiverInput {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  signatureDataUrl: string;
  consentElectronic: boolean;
  consentTerms: boolean;
  isMinor: boolean;
  guardianName?: string;
}

export async function submitStandaloneWaiver(
  data: StandaloneWaiverInput,
  signerIp: string,
  signerUa: string,
): Promise<ServiceResult<{ waiverId: string; success: boolean }>> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const customerId = await upsertCustomer(client, {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
    });

    const waiverText = await getWaiverTextFromCMS();

    const { pdfBuffer, sha256 } = await generateWaiverPdf({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
      reservationId: 'standalone',
      signatureDataUrl: data.signatureDataUrl,
      signerIp,
      signerUa,
      waiverText: waiverText || undefined,
    });

    const storageKey = `waivers/standalone-${customerId}-${Date.now()}.pdf`;
    await uploadWaiverPdf(storageKey, pdfBuffer);

    const waiverResult = await client.query(
      `INSERT INTO bookings.waivers
        (reservation_id, customer_id, pdf_storage_key, pdf_sha256, signed_at, signer_ip, signer_ua, consent_electronic, consent_terms, is_minor, guardian_customer_id)
      VALUES (NULL, $1, $2, $3, NOW(), $4::inet, $5, $6, $7, $8, NULL)
      RETURNING id`,
      [
        customerId,
        storageKey,
        sha256,
        signerIp,
        signerUa,
        data.consentElectronic,
        data.consentTerms,
        data.isMinor,
      ],
    );

    await client.query('COMMIT');

    return ok({ waiverId: waiverResult.rows[0].id, success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Standalone waiver submission error');
    return fail(500, 'Failed to submit standalone waiver');
  } finally {
    client.release();
  }
}

// ── Get unlinked waivers ───────────────────────────────────────────────────

export interface UnlinkedWaiver {
  waiver_id: string;
  full_name: string;
  email: string;
  phone: string;
  signed_at: string;
  is_minor: boolean;
}

export async function getUnlinkedWaivers(): Promise<ServiceResult<{ waivers: UnlinkedWaiver[] }>> {
  try {
    const result = await pool.query(`
      SELECT
        w.id AS waiver_id,
        c.full_name,
        c.email,
        c.phone,
        w.signed_at,
        w.is_minor
      FROM bookings.waivers w
      JOIN bookings.customers c ON w.customer_id = c.id
      WHERE w.reservation_id IS NULL
        AND w.signed_at::date = CURRENT_DATE
      ORDER BY w.signed_at DESC
    `);
    return ok({ waivers: result.rows });
  } catch (err) {
    logger.error({ err }, 'Unlinked waivers error');
    return fail(500, 'Failed to fetch unlinked waivers');
  }
}

// ── Link waivers to booking ────────────────────────────────────────────────

export async function linkWaivers(
  reservationId: string,
  waiverIds: string[],
): Promise<ServiceResult<{ linked: number; message: string }>> {
  try {
    const resCheck = await pool.query(
      `SELECT id FROM bookings.reservations WHERE id = $1`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      return fail(404, 'Booking not found');
    }

    const updateResult = await pool.query(
      `UPDATE bookings.waivers
       SET reservation_id = $1
       WHERE id = ANY($2)
         AND reservation_id IS NULL
       RETURNING id`,
      [reservationId, waiverIds],
    );

    if (updateResult.rowCount && updateResult.rowCount > 0) {
      const firstWaiver = await pool.query(
        `SELECT customer_id FROM bookings.waivers WHERE id = $1`,
        [updateResult.rows[0].id],
      );
      if (firstWaiver.rows[0]?.customer_id) {
        await pool.query(
          `UPDATE bookings.reservations
           SET customer_id = COALESCE(customer_id, $2), updated_at = NOW()
           WHERE id = $1`,
          [reservationId, firstWaiver.rows[0].customer_id],
        );
      }
    }

    const linked = updateResult.rowCount || 0;
    return ok({ linked, message: `${linked} waiver(s) linked to booking` });
  } catch (err) {
    logger.error({ err }, 'Link waivers error');
    return fail(500, 'Failed to link waivers');
  }
}

// ── Get waiver PDF for booking ─────────────────────────────────────────────

export async function getWaiverForBooking(
  reservationId: string,
): Promise<ServiceResult<{ pdfBuffer: Buffer; safeName: string }>> {
  try {
    const result = await pool.query(
      `SELECT w.pdf_storage_key, c.full_name
       FROM bookings.waivers w
       JOIN bookings.reservations r ON r.id = w.reservation_id
       LEFT JOIN bookings.customers c ON w.customer_id = c.id
       WHERE r.id = $1`,
      [reservationId],
    );

    if (result.rowCount === 0) {
      return fail(404, 'Waiver not found for this booking');
    }

    const { pdf_storage_key, full_name } = result.rows[0];
    const pdfBuffer = await getWaiverPdf(pdf_storage_key);
    const safeName = (full_name || 'waiver').replace(/[^a-zA-Z0-9-_ ]/g, '').trim();

    return ok({ pdfBuffer, safeName });
  } catch (err) {
    logger.error({ err }, 'Waiver download error');
    return fail(500, 'Failed to download waiver');
  }
}
