import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { availabilityRouter } from './routes/availability.js';
import { bookingsRouter } from './routes/bookings.js';
import { waiversRouter } from './routes/waivers.js';
import { contactRouter } from './routes/contact.js';
import { adminRouter } from './routes/admin/index.js';
import { adminAuth } from './middleware/adminAuth.js';
import pool from './db/pool.js';

const app: ReturnType<typeof express> = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4321,http://localhost:3003')
  .split(',')
  .map((o) => o.trim());

// Security headers (CSP allows Moneris iframe for payment tokenization)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        frameSrc: ["'self'", 'https://*.moneris.com'],
        connectSrc: ["'self'", ...allowedOrigins],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS - only allow our frontend origins
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

// Body parsing with strict limits
app.use(express.json({ limit: '2mb' }));

// Disable X-Powered-By to reduce fingerprinting
app.disable('x-powered-by');

// Global rate limiter: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(globalLimiter);

// Stricter rate limit for booking/payment endpoints: 10 per minute per IP
const bookingLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking attempts, please try again later' },
});

// Admin rate limiter: 30 requests per minute per IP
const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please try again later' },
});

// Health check (no rate limit)
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', message: 'Database connection failed' });
  }
});

app.use('/api/availability', availabilityRouter);
app.use('/api/bookings', bookingLimiter, bookingsRouter);
app.use('/api/waivers', bookingLimiter, waiversRouter);
app.use('/api/contact', bookingLimiter, contactRouter);
app.use('/api/admin', adminLimiter, adminAuth, adminRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler — never leak stack traces to client
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
