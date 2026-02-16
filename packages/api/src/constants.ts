/**
 * Shared constants used across routes and services.
 */

export const TIMEZONE = 'America/Edmonton';

export const DURATION_HOURS: Record<string, number> = { '2h': 2, '4h': 4, '8h': 8 };

/** Map duration type → price column in the bikes table. */
export const PRICE_COLUMN: Record<string, string> = {
  '2h': 'price2h',
  '4h': 'price4h',
  '8h': 'price8h',
  'multi-day': 'price_per_day',
};

export const DURATION_LABELS: Record<string, string> = {
  '2h': '2 Hours',
  '4h': '4 Hours',
  '8h': 'Full Day',
  'multi-day': 'Multi-Day',
};
