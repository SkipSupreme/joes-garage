import type { Alpine } from 'alpinejs';
import { DURATION_LABELS } from '@joes-garage/shared/constants';
import { API_URL, loadQRCode } from './shared';

export function registerConfirmation(Alpine: Alpine) {
  Alpine.data('confirmation', () => ({
    booking: null as any,
    loading: true,
    error: null as string | null,
    waiverUrl: '',
    qrDataUrl: '',

    get itemCount() {
      return (this.booking as any)?.item_count || 1;
    },
    get signedWaiverCount() {
      return ((this.booking as any)?.waivers || []).length;
    },
    get remainingWaivers() {
      return Math.max(0, this.itemCount - this.signedWaiverCount);
    },
    get needsMoreWaivers() {
      return this.itemCount > 1 && this.remainingWaivers > 0;
    },

    init() {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      if (!id) {
        this.loading = false;
        this.error = 'No booking ID provided.';
        return;
      }
      this.fetchBooking(id);
    },

    async fetchBooking(id: string) {
      try {
        const res = await fetch(`${API_URL}/api/bookings/${id}`);
        if (!res.ok) throw new Error('Booking not found');
        this.booking = await res.json();
        await this.generateWaiverQR();
      } catch (err: any) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async generateWaiverQR() {
      const b = this.booking as any;
      if (!b?.booking_ref) return;
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || b.booking_token || '';
      const baseUrl = window.location.origin;
      this.waiverUrl = `${baseUrl}/waiver/${b.booking_ref}?token=${token}`;
      try {
        const QRCode = await loadQRCode();
        this.qrDataUrl = await QRCode.toDataURL(this.waiverUrl, {
          width: 200,
          margin: 2,
          color: { dark: '#111111', light: '#FFFFFF' },
        });
      } catch (err) {
        console.error('QR generation failed:', err);
      }
    },

    get durationLabel() {
      const b = this.booking as any;
      if (!b?.duration_type) return '';
      return DURATION_LABELS[b.duration_type] || b.duration_type;
    },

    formatPeriod(periodStr: string) {
      if (!periodStr) return 'N/A';
      const cleaned = periodStr.replace(/^[\[(]|[\])]$/g, '');
      const parts = cleaned.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      if (parts.length !== 2) return periodStr;
      const start = new Date(parts[0]);
      const end = new Date(parts[1]);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return periodStr;
      const dateOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', weekday: 'short' };
      const timeOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/Edmonton', hour: 'numeric', minute: '2-digit' };
      if (start.toLocaleDateString('en-CA', dateOpts) === end.toLocaleDateString('en-CA', dateOpts)) {
        return `${start.toLocaleDateString('en-CA', dateOpts)}, ${start.toLocaleTimeString('en-CA', timeOpts)} – ${end.toLocaleTimeString('en-CA', timeOpts)}`;
      }
      const opts: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Edmonton',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      };
      return `${start.toLocaleString('en-CA', opts)} – ${end.toLocaleString('en-CA', opts)}`;
    },
  }));
}
