/**
 * Client-side API helpers for the booking system.
 * Called from Alpine.js components via fetch().
 */

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3001';

export async function checkAvailability(params: {
  date: string;
  duration: '2h' | '4h' | '8h' | 'multi-day';
  startTime?: string;
  endDate?: string;
}) {
  const qs = new URLSearchParams({ date: params.date, duration: params.duration });
  if (params.duration === 'multi-day' && params.endDate) {
    qs.set('endDate', params.endDate);
  } else if (params.startTime) {
    qs.set('startTime', params.startTime);
  }
  const res = await fetch(`${API_URL}/api/availability?${qs}`);
  if (!res.ok) throw new Error('Failed to check availability');
  return res.json();
}

export async function createHold(params: {
  bikeId: number;
  date: string;
  duration: '2h' | '4h' | '8h' | 'multi-day';
  startTime?: string;
  endDate?: string;
}) {
  const res = await fetch(`${API_URL}/api/bookings/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to create hold');
  return res.json();
}

export async function submitWaiver(data: {
  reservationId: string;
  signatureDataUrl: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  consentElectronic: boolean;
  consentTerms: boolean;
}) {
  const res = await fetch(`${API_URL}/api/waivers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to submit waiver');
  return res.json();
}

export async function processPayment(reservationId: string, monerisToken: string) {
  const res = await fetch(`${API_URL}/api/bookings/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId, monerisToken }),
  });
  if (!res.ok) throw new Error('Failed to process payment');
  return res.json();
}
