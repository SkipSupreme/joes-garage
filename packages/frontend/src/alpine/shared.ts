// ── Shared Alpine helpers (used by booking flow, waiver pages) ──

export const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3001';

export const SHOP_OPEN_HOUR = 9;
export const SHOP_OPEN_MIN = 30; // 9:30 AM
export const SHOP_CLOSE = 18; // 6 PM

// Heavy libs loaded dynamically — only on pages that need them
export const loadFlatpickr = () => import('flatpickr').then((m) => m.default);
export const loadSignaturePad = () => import('signature_pad').then((m) => m.default);
export const loadQRCode = () => import('qrcode');

export const DOB_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function getDobDays(dobMonth: string, dobYear: string): number[] {
  const m = parseInt(dobMonth);
  const y = parseInt(dobYear) || 2000;
  if (!m) return Array.from({ length: 31 }, (_, i) => i + 1);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => i + 1);
}

export function getDobYears(): number[] {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now - 16; y >= now - 100; y--) years.push(y);
  return years;
}

export function formatDateOfBirth(dobYear: string, dobMonth: string, dobDay: string): string {
  if (!dobYear || !dobMonth || !dobDay) return '';
  return `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`;
}

export async function createSignaturePad(canvasId: string): Promise<any | null> {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return null;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext('2d')!.scale(ratio, ratio);
  const SignaturePad = await loadSignaturePad();
  return new SignaturePad(canvas, {
    backgroundColor: 'rgb(255, 255, 255)',
    penColor: 'rgb(30, 30, 30)',
  });
}
