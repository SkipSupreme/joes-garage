import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || 'dev-admin-secret-change-in-production';

if (!process.env.ADMIN_API_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('ADMIN_API_SECRET environment variable is required in production');
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ ip: req.ip, path: req.path, reason: 'missing_token' }, 'Admin auth failed');
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  const valid = token.length === ADMIN_SECRET.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_SECRET));

  if (!valid) {
    logger.warn({ ip: req.ip, path: req.path, reason: 'invalid_token' }, 'Admin auth failed');
    res.status(403).json({ error: 'Invalid admin credentials' });
    return;
  }

  next();
}
