/**
 * Client-side API helpers for the booking system.
 * Called from Alpine.js components via fetch().
 */

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3001';

export async function checkAvailability(startDate: string, endDate: string) {
  const res = await fetch(`${API_URL}/api/availability?start=${startDate}&end=${endDate}`);
  if (!res.ok) throw new Error('Failed to check availability');
  return res.json();
}

export async function createHold(bikeId: number, startDate: string, endDate: string) {
  const res = await fetch(`${API_URL}/api/bookings/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bikeId, startDate, endDate }),
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
