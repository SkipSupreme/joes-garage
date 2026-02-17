/**
 * Shared Zod schemas for request validation.
 * Used by the API for input validation. The frontend can also import
 * these for client-side validation if desired.
 */

import { z } from 'zod';
import { BOOKING_STATUSES, DURATION_TYPES } from './constants.js';

// ── Primitives ───────────────────────────────────────────────────────────

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM');
export const uuidParam = z.string().uuid();

// ── Duration ─────────────────────────────────────────────────────────────

export const durationSchema = z.enum(DURATION_TYPES);

// ── Availability ─────────────────────────────────────────────────────────

export const availabilityQuerySchema = z.object({
  date: dateString,
  duration: durationSchema,
  startTime: timeString.optional(),
  endDate: dateString.optional(),
});

// ── Customer ─────────────────────────────────────────────────────────────

export const customerSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().max(254),
  phone: z.string().min(7).max(20),
});

// ── Hold creation ────────────────────────────────────────────────────────

export const createHoldSchema = z.object({
  date: dateString,
  duration: durationSchema,
  startTime: timeString.optional(),
  endDate: dateString.optional(),
  bikes: z.array(z.object({
    bikeId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(10),
  })).min(1).max(20),
  customer: customerSchema,
});

// ── Waiver ───────────────────────────────────────────────────────────────

export const submitWaiverSchema = z.object({
  reservationId: z.string().uuid().optional(),
  fullName: z.string().min(2).max(200),
  email: z.string().email().max(254),
  phone: z.string().min(7).max(20),
  dateOfBirth: dateString,
  isMinor: z.boolean(),
  guardianName: z.string().min(2).max(200).optional(),
  signatureDataUrl: z.string().min(1),
  consentElectronic: z.literal(true),
  consentTerms: z.literal(true),
});

// ── Admin: bookings query ────────────────────────────────────────────────

export const bookingsQuerySchema = z.object({
  status: z.enum(['all', ...BOOKING_STATUSES] as [string, ...string[]]).default('all'),
  date: z.enum(['all', 'today', 'upcoming', 'past']).default('all'),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// ── Admin: walk-in ───────────────────────────────────────────────────────

export const walkInSchema = z.object({
  bikes: z.array(z.object({
    bikeId: z.number().int().positive(),
  })).min(1).max(20),
  duration: durationSchema,
  endDate: dateString.optional(),
  customer: z.object({
    fullName: z.string().min(1).max(200),
    phone: z.string().min(1).max(30),
    email: z.string().email().max(200).optional(),
  }),
}).refine(
  (data) => data.duration !== 'multi-day' || !!data.endDate,
  { message: 'Multi-day walk-ins require an endDate' },
);

// ── Admin: actions ───────────────────────────────────────────────────────

export const checkOutSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
});

export const checkInSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(2000).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const extendSchema = z.object({
  newReturnTime: z.string().datetime({ offset: true }),
});

export const noteSchema = z.object({
  text: z.string().min(1).max(2000),
});

export const linkWaiversSchema = z.object({
  waiverIds: z.array(z.string().uuid()).min(1).max(20),
});
