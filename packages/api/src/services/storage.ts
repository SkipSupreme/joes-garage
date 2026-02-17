import { writeFile, readFile, mkdir } from 'fs/promises';
import path from 'path';

/**
 * Storage service — saves waiver PDFs.
 *
 * Local dev: writes to disk (./storage/)
 * Production: upload to Hetzner Object Storage (S3-compatible) via aws-sdk.
 */

const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve(process.cwd(), 'storage');

// Ensure storage directory exists on startup
await mkdir(STORAGE_DIR, { recursive: true });

function validateKey(key: string): string {
  const filePath = path.join(STORAGE_DIR, key);
  const resolved = path.resolve(filePath);
  const storageRoot = path.resolve(STORAGE_DIR);
  if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
    throw new Error('Invalid storage key: path traversal detected');
  }
  return filePath;
}

export async function uploadWaiverPdf(key: string, pdfBuffer: Buffer): Promise<string> {
  if (process.env.S3_ENDPOINT) {
    throw new Error('S3 storage not yet configured — set up aws-sdk when ready for production');
  }

  const filePath = validateKey(key);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, pdfBuffer);
  return filePath;
}

export async function getWaiverPdf(key: string): Promise<Buffer> {
  if (process.env.S3_ENDPOINT) {
    throw new Error('S3 storage not yet configured');
  }

  const filePath = validateKey(key);
  return readFile(filePath);
}
