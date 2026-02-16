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
    throw new Error('S3 storage not yet configured — set up aws-sdk when ready for production');
  }

  // Local dev: write to disk
  const filePath = path.join(STORAGE_DIR, key);
  const resolved = path.resolve(filePath);
  const storageRoot = path.resolve(STORAGE_DIR);
  if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
    throw new Error('Invalid storage key: path traversal detected');
  }
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
  const resolved = path.resolve(filePath);
  const storageRoot = path.resolve(STORAGE_DIR);
  if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
    throw new Error('Invalid storage key: path traversal detected');
  }
  return readFileSync(filePath);
}
