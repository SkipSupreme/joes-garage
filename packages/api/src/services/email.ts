import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getWaiverPdf } from './storage.js';

/**
 * Email service — sends booking confirmations and admin notifications.
 *
 * Dev mode: Uses Ethereal (fake SMTP) — preview URLs logged to console.
 * Production: Uses real SMTP credentials from environment variables.
 */

let transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    // Production SMTP
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    });
  } else {
    // Dev: Ethereal test account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log(`Ethereal email account: ${testAccount.user}`);
  }

  return transporter;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || 'Joe\'s Garage <bookings@joes-garage.ca>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'joe@joes-garage.ca';
const SHOP_PHONE = process.env.SHOP_PHONE || '(403) 555-0199';

const DURATION_LABELS: Record<string, string> = {
  '2h': '2 Hours',
  '4h': '4 Hours',
  '8h': 'Full Day',
  'multi-day': 'Multi-Day',
};

interface BookingItem {
  bikeName: string;
  bikeType: string;
  rentalPrice: string;
  depositAmount: string;
}

interface BookingDetails {
  bookingId: string;
  confirmationNumber: string;
  customerName: string;
  customerEmail: string;
  /** @deprecated Use items[] instead */
  bikeName?: string;
  /** @deprecated Use items[] instead */
  bikeType?: string;
  items?: BookingItem[];
  startDate: string;
  endDate: string;
  durationType: string;
  totalAmount: string;
  depositAmount: string;
  waiverStorageKey?: string;
}

/**
 * Send booking confirmation email to the customer.
 * Attaches the signed waiver PDF if available.
 */
export async function sendBookingConfirmation(details: BookingDetails): Promise<void> {
  const transport = await getTransporter();

  const attachments: nodemailer.SendMailOptions['attachments'] = [];

  // Attach waiver PDF if we have it
  if (details.waiverStorageKey) {
    try {
      const pdfBuffer = await getWaiverPdf(details.waiverStorageKey);
      attachments.push({
        filename: `waiver-${details.confirmationNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    } catch (err) {
      console.error('Failed to attach waiver PDF to confirmation email:', err);
    }
  }

  // Build bike rows — supports both single-bike (legacy) and multi-bike (items[])
  const items = details.items && details.items.length > 0
    ? details.items
    : details.bikeName
      ? [{ bikeName: details.bikeName, bikeType: details.bikeType || '', rentalPrice: '0', depositAmount: '0' }]
      : [];

  const isMultiBike = items.length > 1;

  const bikeRowsHtml = isMultiBike
    ? items.map((item, i) => `
            <tr>
              <td style="padding: 8px 0; color: #666;">${i === 0 ? 'Bikes' : ''}</td>
              <td style="padding: 8px 0;">${escapeHtml(item.bikeName)} (${escapeHtml(item.bikeType)}) &mdash; $${item.rentalPrice} + $${item.depositAmount} deposit</td>
            </tr>`).join('')
    : items.length === 1
      ? `
            <tr>
              <td style="padding: 8px 0; color: #666;">Bike</td>
              <td style="padding: 8px 0;">${escapeHtml(items[0].bikeName)} (${escapeHtml(items[0].bikeType)})</td>
            </tr>`
      : '';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: #c41e1e; padding: 24px 32px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 24px;">Joe's Garage</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 14px;">Bike Rental Confirmation</p>
      </div>

      <div style="background: #faf8f5; padding: 32px; border: 1px solid #e8e0d4; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px; margin: 0 0 24px;">Hi ${escapeHtml(details.customerName)},</p>

        <p style="font-size: 16px; margin: 0 0 24px;">
          Your bike rental has been confirmed! Here are your booking details:
        </p>

        <div style="background: #fff; border: 1px solid #e8e0d4; border-radius: 6px; padding: 20px; margin: 0 0 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; color: #666; width: 140px;">Confirmation #</td>
              <td style="padding: 8px 0; font-weight: 600; font-size: 18px; letter-spacing: 1px;">${escapeHtml(details.confirmationNumber)}</td>
            </tr>
            ${bikeRowsHtml}
            <tr>
              <td style="padding: 8px 0; color: #666;">Duration</td>
              <td style="padding: 8px 0;">${escapeHtml(DURATION_LABELS[details.durationType] || details.durationType)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">Pickup</td>
              <td style="padding: 8px 0;">${formatTimestamp(details.startDate)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">Return</td>
              <td style="padding: 8px 0;">${formatTimestamp(details.endDate)}</td>
            </tr>
            <tr style="border-top: 1px solid #e8e0d4;">
              <td style="padding: 12px 0 4px; color: #666;">Deposit (pre-authorized)</td>
              <td style="padding: 12px 0 4px; font-weight: 600;">$${details.depositAmount}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0 8px; color: #666;">Total rental cost</td>
              <td style="padding: 4px 0 8px; font-weight: 600;">$${details.totalAmount}</td>
            </tr>
          </table>
        </div>

        <div style="background: #fef3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 16px; margin: 0 0 24px; font-size: 14px;">
          <strong>Pickup Instructions:</strong> Please arrive at Joe's Garage with a valid photo ID.
          We'll walk you through the bike${isMultiBike ? 's' : ''} and get you on your way!
        </div>

        ${details.waiverStorageKey ? '<p style="font-size: 14px; color: #666; margin: 0 0 24px;">Your signed waiver is attached to this email as a PDF for your records.</p>' : ''}

        <p style="font-size: 14px; color: #666; margin: 0 0 8px;">
          <strong>Joe's Garage</strong><br>
          335 8 St SW, Calgary, AB<br>
          ${SHOP_PHONE}
        </p>

        <p style="font-size: 12px; color: #999; margin: 24px 0 0; border-top: 1px solid #e8e0d4; padding-top: 16px;">
          Booking ID: ${escapeHtml(details.bookingId)}
        </p>
      </div>
    </div>
  `;

  const info = await transport.sendMail({
    from: FROM_ADDRESS,
    to: details.customerEmail,
    subject: `Booking Confirmed — ${details.confirmationNumber} | Joe's Garage`,
    html,
    attachments,
  });

  // Log Ethereal preview URL in dev
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`📧 Email preview: ${previewUrl}`);
  }
}

/**
 * Send a new booking notification to Joe (admin).
 */
export async function sendAdminNotification(details: BookingDetails): Promise<void> {
  const transport = await getTransporter();

  // Build bike rows for admin email — supports both legacy and multi-bike
  const adminItems = details.items && details.items.length > 0
    ? details.items
    : details.bikeName
      ? [{ bikeName: details.bikeName, bikeType: details.bikeType || '', rentalPrice: '0', depositAmount: '0' }]
      : [];

  const adminBikeRowsHtml = adminItems.length > 1
    ? adminItems.map((item, i) => `
        <tr><td style="padding: 6px 0; color: #666;">${i === 0 ? 'Bikes' : ''}</td><td style="padding: 6px 0;">${escapeHtml(item.bikeName)} (${escapeHtml(item.bikeType)}) &mdash; $${item.rentalPrice} + $${item.depositAmount} dep.</td></tr>`).join('')
    : adminItems.length === 1
      ? `<tr><td style="padding: 6px 0; color: #666;">Bike</td><td style="padding: 6px 0;">${escapeHtml(adminItems[0].bikeName)} (${escapeHtml(adminItems[0].bikeType)})</td></tr>`
      : '';

  const adminSubjectBike = adminItems.length > 1
    ? `${adminItems.length} bikes`
    : adminItems.length === 1
      ? escapeHtml(adminItems[0].bikeName)
      : 'Rental';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px; color: #c41e1e;">New Bike Rental Booking</h2>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #666; width: 120px;">Confirmation</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(details.confirmationNumber)}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Customer</td><td style="padding: 6px 0;">${escapeHtml(details.customerName)} (${escapeHtml(details.customerEmail)})</td></tr>
        ${adminBikeRowsHtml}
        <tr><td style="padding: 6px 0; color: #666;">Duration</td><td style="padding: 6px 0;">${escapeHtml(DURATION_LABELS[details.durationType] || details.durationType)}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Period</td><td style="padding: 6px 0;">${formatTimestamp(details.startDate)} &rarr; ${formatTimestamp(details.endDate)}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Deposit</td><td style="padding: 6px 0;">$${details.depositAmount}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Total</td><td style="padding: 6px 0; font-weight: 600;">$${details.totalAmount}</td></tr>
      </table>

      <p style="font-size: 12px; color: #999; margin: 16px 0 0;">Booking ID: ${escapeHtml(details.bookingId)}</p>
    </div>
  `;

  const info = await transport.sendMail({
    from: FROM_ADDRESS,
    to: ADMIN_EMAIL,
    subject: `New Booking: ${escapeHtml(details.customerName)} — ${adminSubjectBike}`,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`📧 Admin email preview: ${previewUrl}`);
  }
}

/**
 * Send a contact form notification to Joe (admin).
 */
interface ContactDetails {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

const subjectLabels: Record<string, string> = {
  repair: 'Repair Quote',
  rental: 'Rental Question',
  general: 'General Inquiry',
  other: 'Something Else',
};

export async function sendContactNotification(details: ContactDetails): Promise<void> {
  const transport = await getTransporter();

  const subjectLabel = subjectLabels[details.subject] || details.subject;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a;">
      <div style="background: #c41e1e; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">New Contact Form Message</h1>
      </div>

      <div style="background: #faf8f5; padding: 24px; border: 1px solid #e8e0d4; border-top: none; border-radius: 0 0 8px 8px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
          <tr><td style="padding: 6px 0; color: #666; width: 80px;">From</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(details.name)}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Email</td><td style="padding: 6px 0;"><a href="mailto:${escapeHtml(details.email)}" style="color: #c41e1e;">${escapeHtml(details.email)}</a></td></tr>
          ${details.phone ? `<tr><td style="padding: 6px 0; color: #666;">Phone</td><td style="padding: 6px 0;">${escapeHtml(details.phone)}</td></tr>` : ''}
          <tr><td style="padding: 6px 0; color: #666;">Topic</td><td style="padding: 6px 0;">${escapeHtml(subjectLabel)}</td></tr>
        </table>

        <div style="background: #fff; border: 1px solid #e8e0d4; border-radius: 6px; padding: 16px;">
          <p style="margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(details.message)}</p>
        </div>

        <p style="font-size: 12px; color: #999; margin: 16px 0 0;">
          Reply directly to this email to respond to ${escapeHtml(details.name)}.
        </p>
      </div>
    </div>
  `;

  const info = await transport.sendMail({
    from: FROM_ADDRESS,
    to: ADMIN_EMAIL,
    replyTo: details.email,
    subject: `Contact: ${escapeHtml(subjectLabel)} from ${escapeHtml(details.name)}`,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`📧 Contact email preview: ${previewUrl}`);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTimestamp(tsStr: string): string {
  if (!tsStr) return 'N/A';
  const d = new Date(tsStr);
  if (isNaN(d.getTime())) return tsStr;
  return d.toLocaleString('en-CA', {
    timeZone: 'America/Edmonton',
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
