import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(dirname, '..', 'templates', 'waiver.html');
const templateHtml = readFileSync(templatePath, 'utf-8');

const DEFAULT_WAIVER_TEXT = `
<p>By signing this waiver, I acknowledge and agree to the following:</p>
<p><strong>1. Assumption of Risk.</strong> I understand that cycling involves inherent risks including but not limited to: falls, collisions, mechanical failure, weather conditions, road hazards, and other cyclists or vehicles. I voluntarily assume all such risks.</p>
<p><strong>2. Condition of Equipment.</strong> I agree to inspect the bicycle before use and to notify Joe's Garage immediately of any defects. I will not operate a bicycle that appears unsafe.</p>
<p><strong>3. Helmet Use.</strong> I understand that wearing a helmet is strongly recommended and may be required by law. I accept full responsibility for my decision regarding helmet use.</p>
<p><strong>4. Return Condition.</strong> I agree to return the bicycle in the same condition as received, normal wear excepted. I accept financial responsibility for any damage or loss.</p>
<p><strong>5. Release of Liability.</strong> I hereby release Joe's Garage, its owners, employees, and agents from any and all claims, damages, or liability arising from my use of the rented bicycle.</p>
<p><strong>6. Medical.</strong> I confirm that I am physically able to operate a bicycle and have no medical conditions that would make cycling dangerous.</p>
`;

interface WaiverData {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  reservationId: string;
  signatureDataUrl: string;
  signerIp: string;
  signerUa: string;
  waiverText?: string;
}

/**
 * Generate a waiver PDF from the HTML template using Puppeteer.
 * Returns { pdfBuffer, sha256 }.
 */
export async function generateWaiverPdf(data: WaiverData): Promise<{ pdfBuffer: Buffer; sha256: string }> {
  const signedAt = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // First pass: render without hash (hash placeholder)
  let html = templateHtml
    .replace(/\{\{fullName\}\}/g, escapeHtml(data.fullName))
    .replace(/\{\{email\}\}/g, escapeHtml(data.email))
    .replace(/\{\{phone\}\}/g, escapeHtml(data.phone))
    .replace(/\{\{dateOfBirth\}\}/g, escapeHtml(data.dateOfBirth))
    .replace(/\{\{reservationId\}\}/g, escapeHtml(data.reservationId))
    .replace(/\{\{signedAt\}\}/g, escapeHtml(signedAt))
    .replace(/\{\{signerIp\}\}/g, escapeHtml(data.signerIp))
    .replace(/\{\{signerUa\}\}/g, escapeHtml(data.signerUa.slice(0, 100)))
    .replace(/\{\{signatureDataUrl\}\}/g, data.signatureDataUrl)
    .replace(/\{\{waiverText\}\}/g, data.waiverText || DEFAULT_WAIVER_TEXT);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    // Generate PDF without hash first to compute hash
    html = html.replace(/\{\{pdfHash\}\}/g, 'Computing...');
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = Buffer.from(
      await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      }),
    );

    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');

    // Second pass: render with actual hash embedded
    const finalHtml = html.replace('Computing...', sha256);
    await page.setContent(finalHtml, { waitUntil: 'networkidle0' });

    const finalPdf = Buffer.from(
      await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      }),
    );

    const finalSha256 = createHash('sha256').update(finalPdf).digest('hex');

    return { pdfBuffer: finalPdf, sha256: finalSha256 };
  } finally {
    await browser.close();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
