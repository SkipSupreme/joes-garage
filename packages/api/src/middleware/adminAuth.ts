import type { Request, Response, NextFunction } from 'express';

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || 'dev-admin-secret-change-in-production';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  if (token !== ADMIN_SECRET) {
    res.status(403).json({ error: 'Invalid admin credentials' });
    return;
  }

  next();
}
