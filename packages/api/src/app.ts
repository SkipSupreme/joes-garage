import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { availabilityRouter } from './routes/availability.js';
import { bookingsRouter } from './routes/bookings.js';
import { waiversRouter } from './routes/waivers.js';
import { contactRouter } from './routes/contact.js';
import { adminRouter } from './routes/admin/index.js';
import { adminAuth } from './middleware/adminAuth.js';
import { AppError, ValidationError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import pool from './db/pool.js';
import { ZodError } from 'zod';

const app: ReturnType<typeof express> = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4321,http://localhost:3003')
  .split(',')
  .map((o) => o.trim());

// 1. Security headers (CSP allows Moneris iframe for payment tokenization)
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

// 2. Compress responses (gzip/deflate) — ~60-80% size reduction for JSON
app.use(compression({ threshold: 1024 }));

// 3. CORS - only allow our frontend origins
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

// 4. Structured request logging
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === '/api/health' || req.url === '/api/v1/health',
    },
  }),
);

// 5. Body parsing with strict limits
app.use(express.json({ limit: '2mb' }));

// 6. Disable X-Powered-By to reduce fingerprinting
app.disable('x-powered-by');

// 7. Global rate limiter: 100 requests per minute per IP
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

// Health check (no rate limit, outside versioned routes)
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', message: 'Database connection failed' });
  }
});

// --- Versioned API routes (v1) ---
const v1 = express.Router();
v1.use('/availability', availabilityRouter);
v1.use('/bookings', bookingLimiter, bookingsRouter);
v1.use('/waivers', bookingLimiter, waiversRouter);
v1.use('/contact', bookingLimiter, contactRouter);
v1.use('/admin', adminLimiter, adminAuth, adminRouter);

app.use('/api/v1', v1);
app.use('/api', v1); // backwards-compatible alias

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler — distinguishes operational vs unexpected errors
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors,
    });
    return;
  }

  // Known operational errors (AppError, NotFoundError, ConflictError, etc.)
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { error: err.message, code: err.code };
    if (err instanceof ValidationError && err.details) {
      body.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected errors — log full details, return generic message
  req.log.error(err, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
