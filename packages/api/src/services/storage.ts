import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Storage service — saves waiver PDFs.
 *
 * Local dev: writes to disk (./storage/)
 * Production: upload to Hetzner Object Storage (S3-compatible) via aws-sdk.
 */

const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve(process.cwd(), 'storage');

// Ensure storage directory exists
if (!existsSync(STORAGE_DIR)) {
  mkdirSync(STORAGE_DIR, { recursive: true });
}

export async function uploadWaiverPdf(key: string, pdfBuffer: Buffer): Promise<string> {
  if (process.env.S3_ENDPOINT) {
    // Production: upload to S3-compatible storage
    // TODO: Implement S3 upload with aws-sdk
    // const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, ... });
    // await s3.send(new PutObjectCommand({ Bucket: 'waivers', Key: key, Body: pdfBuffer }));
    throw new Error('S3 storage not yet configured');
  }

  // Local dev: write to disk
  const filePath = path.join(STORAGE_DIR, key);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, pdfBuffer);
  return filePath;
}

export async function getWaiverPdf(key: string): Promise<Buffer> {
  if (process.env.S3_ENDPOINT) {
    throw new Error('S3 storage not yet configured');
  }

  const filePath = path.join(STORAGE_DIR, key);
  return readFileSync(filePath);
}
