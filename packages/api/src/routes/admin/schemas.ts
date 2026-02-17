import { z } from 'zod';

export const uuidParam = z.string().uuid();

export const bookingsQuerySchema = z.object({
  status: z.enum(['all', 'hold', 'paid', 'active', 'overdue', 'completed', 'cancelled']).default('all'),
  date: z.enum(['all', 'today', 'upcoming', 'past']).default('all'),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

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

export const walkInSchema = z.object({
  bikes: z.array(z.object({ bikeId: z.number().int().positive() })).min(1).max(20),
  duration: z.enum(['2h', '4h', '8h', 'multi-day']),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customer: z.object({
    fullName: z.string().min(1).max(200),
    phone: z.string().min(1).max(30),
    email: z.string().email().max(200).optional(),
  }),
}).refine(
  (data) => data.duration !== 'multi-day' || !!data.endDate,
  { message: 'Multi-day walk-ins require an endDate' },
);

export const linkWaiversSchema = z.object({
  waiverIds: z.array(z.string().uuid()).min(1).max(20),
});
