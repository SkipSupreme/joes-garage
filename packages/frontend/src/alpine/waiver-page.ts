import type { Alpine } from 'alpinejs';
import { DURATION_LABELS } from '@joes-garage/shared/constants';
import {
  API_URL, DOB_MONTHS,
  getDobDays, getDobYears, formatDateOfBirth,
  createSignaturePad,
} from './shared';

export function registerWaiverPage(Alpine: Alpine) {
  Alpine.data('waiverPage', () => ({
    ref: '' as string,
    loading: true,
    submitting: false,
    error: null as string | null,
    successMessage: null as string | null,
    booking: null as any,
    waivers: [] as any[],
    itemCount: 0,

    waiver: {
      fullName: '',
      email: '',
      phone: '',
      dobMonth: '',
      dobDay: '',
      dobYear: '',
      isMinor: false,
      guardianName: '',
      consentElectronic: false,
      consentTerms: false,
    },
    signaturePad: null as any,

    get allSigned() {
      return this.waivers.length >= this.itemCount && this.itemCount > 0;
    },
    get remainingWaivers() {
      return Math.max(0, this.itemCount - this.waivers.length);
    },
    get durationLabel() {
      if (!this.booking?.duration_type) return '';
      return DURATION_LABELS[this.booking.duration_type] || this.booking.duration_type;
    },
    get dobMonths() { return DOB_MONTHS; },
    get dobDays() { return getDobDays(this.waiver.dobMonth, this.waiver.dobYear); },
    get dobYears() { return getDobYears(); },
    get dateOfBirth() { return formatDateOfBirth(this.waiver.dobYear, this.waiver.dobMonth, this.waiver.dobDay); },

    init() {
      const el = this.$el as HTMLElement;
      this.ref = el.dataset.ref || '';
      if (this.ref) {
        this.fetchBooking();
      } else {
        this.loading = false;
        this.error = 'No booking reference provided.';
      }
    },

    async fetchBooking() {
      this.loading = true;
      this.error = null;
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
        const res = await fetch(`${API_URL}/api/bookings/${this.ref}${tokenQuery}`);
        if (!res.ok) throw new Error('Booking not found.');
        const data = await res.json();
        this.booking = data;
        this.waivers = data.waivers || [];
        this.itemCount = data.item_count || 0;
      } catch (err: any) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }

      if (!this.error && !this.allSigned) {
        this.$nextTick(() => {
          this.signaturePad = createSignaturePad('waiver-signature-pad');
        });
      }
    },

    clearSignature() {
      if (this.signaturePad) this.signaturePad.clear();
    },

    async submitWaiver() {
      this.error = null;
      this.successMessage = null;
      this.submitting = true;

      if (!this.signaturePad) {
        this.error = 'Signature pad failed to load. Please refresh the page.';
        this.submitting = false;
        return;
      }
      if (this.signaturePad.isEmpty()) {
        this.error = 'Please draw your signature.';
        this.submitting = false;
        return;
      }
      const signatureDataUrl = this.signaturePad.toDataURL('image/png');

      try {
        const body: any = {
          reservationId: this.booking?.id || this.ref,
          signatureDataUrl,
          fullName: this.waiver.fullName.trim(),
          email: this.waiver.email.trim(),
          phone: this.waiver.phone.trim(),
          dateOfBirth: this.dateOfBirth,
          consentElectronic: this.waiver.consentElectronic,
          consentTerms: this.waiver.consentTerms,
        };
        if (this.waiver.isMinor && this.waiver.guardianName.trim()) {
          body.guardianName = this.waiver.guardianName.trim();
        }

        const res = await fetch(`${API_URL}/api/waivers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit waiver.');

        this.successMessage = `Waiver signed successfully for ${this.waiver.fullName.trim()}!`;

        this.waiver = {
          fullName: '',
          email: '',
          phone: '',
          dobMonth: '',
          dobDay: '',
          dobYear: '',
          isMinor: false,
          guardianName: '',
          consentElectronic: false,
          consentTerms: false,
        };
        if (this.signaturePad) this.signaturePad.clear();

        await this.fetchBooking();
      } catch (err: any) {
        this.error = err.message;
      } finally {
        this.submitting = false;
      }
    },
  }));
}
