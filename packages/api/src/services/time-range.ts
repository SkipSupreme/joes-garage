import { DURATION_HOURS } from '../constants.js';

export interface RangeBounds {
  rangeStart: string;
  rangeEnd: string;
}

/**
 * Build TSTZRANGE start/end strings from booking parameters.
 *
 * Used by both /bookings/hold and /availability to compute the rental period
 * from date + duration + optional startTime/endDate.
 *
 * NOTE: Walk-in range building (admin walk-in endpoint) uses `new Date()` for
 * the start instead of date strings, so it stays separate.
 */
export function buildRangeBounds(
  date: string,
  duration: string,
  startTime?: string,
  endDate?: string,
): RangeBounds {
  if (duration === 'multi-day') {
    const end = new Date(endDate!);
    end.setDate(end.getDate() + 1);
    return {
      rangeStart: `${date} 00:00`,
      rangeEnd: `${end.toISOString().split('T')[0]} 00:00`,
    };
  }

  if (duration === '8h') {
    // Full Day: fixed shop hours 9:30 AM – 6:00 PM
    return {
      rangeStart: `${date} 09:30`,
      rangeEnd: `${date} 18:00`,
    };
  }

  // Hourly (2h/4h)
  const hours = DURATION_HOURS[duration];
  const [h, m] = startTime!.split(':').map(Number);
  const endH = h + hours;
  const rangeStart = `${date} ${startTime}`;
  let rangeEnd: string;

  if (endH >= 24) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    rangeEnd = `${nextDate.toISOString().split('T')[0]} ${String(endH - 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } else {
    rangeEnd = `${date} ${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return { rangeStart, rangeEnd };
}
