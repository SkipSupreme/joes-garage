import type { Alpine } from 'alpinejs';
import {
  API_URL, DOB_MONTHS,
  getDobDays, getDobYears, formatDateOfBirth,
  createSignaturePad,
} from './shared';

export function registerStandaloneWaiver(Alpine: Alpine) {
  type SignaturePadLike = {
    clear: () => void;
    isEmpty: () => boolean;
    toDataURL: (type?: string) => string;
  };

  Alpine.data('standaloneWaiver', () => ({
    loading: false,
    submitting: false,
    error: null as string | null,
    successName: null as string | null,
    signaturePad: null as SignaturePadLike | null,

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

    get dobMonths() { return DOB_MONTHS; },
    get dobDays() { return getDobDays(this.waiver.dobMonth, this.waiver.dobYear); },
    get dobYears() { return getDobYears(); },
    get dateOfBirth() { return formatDateOfBirth(this.waiver.dobYear, this.waiver.dobMonth, this.waiver.dobDay); },

    init() {
      this.$nextTick(async () => {
        this.signaturePad = await createSignaturePad('waiver-signature-pad');
      });
    },

    clearSignature() {
      const signaturePad = this.signaturePad as SignaturePadLike | null;
      if (signaturePad) signaturePad.clear();
    },

    resetForm() {
      this.waiver = {
        fullName: '', email: '', phone: '',
        dobMonth: '', dobDay: '', dobYear: '',
        isMinor: false, guardianName: '',
        consentElectronic: false, consentTerms: false,
      };
      this.successName = null;
      this.error = null;
      const signaturePad = this.signaturePad as SignaturePadLike | null;
      if (signaturePad) signaturePad.clear();
      this.$nextTick(async () => {
        this.signaturePad = await createSignaturePad('waiver-signature-pad');
      });
    },

    async submitWaiver() {
      this.error = null;
      this.submitting = true;

      const signaturePad = this.signaturePad as SignaturePadLike | null;
      if (!signaturePad || signaturePad.isEmpty()) {
        this.error = 'Please draw your signature.';
        this.submitting = false;
        return;
      }

      try {
        const body: any = {
          signatureDataUrl: signaturePad.toDataURL('image/png'),
          fullName: this.waiver.fullName.trim(),
          email: this.waiver.email.trim(),
          phone: this.waiver.phone.trim(),
          dateOfBirth: this.dateOfBirth,
          consentElectronic: this.waiver.consentElectronic,
          consentTerms: this.waiver.consentTerms,
          isMinor: this.waiver.isMinor,
        };
        if (this.waiver.isMinor && this.waiver.guardianName.trim()) {
          body.guardianName = this.waiver.guardianName.trim();
        }

        const res = await fetch(`${API_URL}/api/waivers/standalone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit waiver.');

        this.successName = this.waiver.fullName.trim();
      } catch (err: any) {
        this.error = err.message;
      } finally {
        this.submitting = false;
      }
    },
  }));
}
