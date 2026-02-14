import type { Alpine } from 'alpinejs';

const API_URL = 'http://localhost:3001';

export default (Alpine: Alpine) => {
  // Booking flow — multi-step rental booking
  Alpine.data('bookingFlow', () => ({
    step: 1,
    loading: false,
    globalError: null as string | null,
    dateError: null as string | null,
    waiverError: null as string | null,
    paymentError: null as string | null,

    // Step 1: Dates
    today: new Date().toISOString().split('T')[0],
    startDate: '',
    endDate: '',

    // Step 2: Bikes
    bikes: [] as any[],
    selectedBike: null as any,
    reservationId: null as string | null,
    holdExpires: null as Date | null,
    holdCountdown: '',
    holdTimer: null as ReturnType<typeof setInterval> | null,

    // Step 3: Waiver
    waiver: {
      fullName: '',
      email: '',
      phone: '',
      dateOfBirth: '',
      consentElectronic: false,
      consentTerms: false,
    },
    signaturePad: null as any,

    // Computed
    get rentalDays() {
      if (!this.startDate || !this.endDate) return 0;
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    },
    get totalAmount() {
      if (!this.selectedBike) return 0;
      return (this.selectedBike.price_per_day * this.rentalDays) + (this.selectedBike.deposit_amount || 0);
    },

    init() {
      this.$watch('startDate', () => this.validateDates());
      this.$watch('endDate', () => this.validateDates());
    },

    validateDates() {
      this.dateError = null;
      if (!this.startDate || !this.endDate) return;

      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (start < today) {
        this.dateError = 'Start date must be today or later.';
      } else if (end < start) {
        this.dateError = 'End date must be on or after start date.';
      } else if (this.rentalDays > 30) {
        this.dateError = 'Maximum rental duration is 30 days.';
      }
    },

    async checkAvailability() {
      this.loading = true;
      this.globalError = null;
      try {
        const res = await fetch(`${API_URL}/api/availability?start=${this.startDate}&end=${this.endDate}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to check availability');
        this.bikes = data.bikes;
        this.step = 2;
      } catch (err: any) {
        this.globalError = err.message;
      } finally {
        this.loading = false;
      }
    },

    selectBike(bike: any) {
      this.selectedBike = bike;
    },

    async createHold() {
      if (!this.selectedBike) return;
      this.loading = true;
      this.globalError = null;
      try {
        const res = await fetch(`${API_URL}/api/bookings/hold`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bikeId: this.selectedBike.id,
            startDate: this.startDate,
            endDate: this.endDate,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create hold');
        this.reservationId = data.reservationId;
        this.holdExpires = new Date(data.holdExpiresAt);
        this.startHoldTimer();
      } catch (err: any) {
        this.globalError = err.message;
      } finally {
        this.loading = false;
      }
    },

    startHoldTimer() {
      if (this.holdTimer) clearInterval(this.holdTimer);
      this.holdTimer = setInterval(() => {
        const now = new Date();
        const diff = (this.holdExpires as Date).getTime() - now.getTime();
        if (diff <= 0) {
          clearInterval(this.holdTimer!);
          this.holdCountdown = 'Expired';
          this.holdExpires = null;
          this.reservationId = null;
          this.step = 1;
          this.globalError = 'Your hold has expired. Please start again.';
          return;
        }
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        this.holdCountdown = `${mins}:${secs.toString().padStart(2, '0')}`;
      }, 1000);
    },

    clearSignature() {
      if (this.signaturePad) this.signaturePad.clear();
    },

    async submitWaiver() {
      this.waiverError = null;
      this.loading = true;

      let signatureDataUrl = '';
      const canvas = document.getElementById('signature-pad') as HTMLCanvasElement | null;
      if (canvas && this.signaturePad) {
        if (this.signaturePad.isEmpty()) {
          this.waiverError = 'Please draw your signature.';
          this.loading = false;
          return;
        }
        signatureDataUrl = this.signaturePad.toDataURL('image/png');
      } else {
        signatureDataUrl = 'data:image/png;base64,placeholder';
      }

      try {
        const res = await fetch(`${API_URL}/api/waivers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reservationId: this.reservationId,
            signatureDataUrl,
            fullName: this.waiver.fullName.trim(),
            email: this.waiver.email.trim(),
            phone: this.waiver.phone.trim(),
            dateOfBirth: this.waiver.dateOfBirth,
            consentElectronic: this.waiver.consentElectronic,
            consentTerms: this.waiver.consentTerms,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit waiver');
        this.step = 4;
      } catch (err: any) {
        this.waiverError = err.message;
      } finally {
        this.loading = false;
      }
    },

    async processPayment() {
      this.paymentError = null;
      this.loading = true;
      try {
        // In production, this token comes from Moneris Hosted Tokenization iframe
        const monerisToken = 'sandbox-token-placeholder';

        const res = await fetch(`${API_URL}/api/bookings/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reservationId: this.reservationId,
            monerisToken,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Payment failed');

        window.location.href = `/book/confirmation?id=${data.bookingId}`;
      } catch (err: any) {
        this.paymentError = err.message;
      } finally {
        this.loading = false;
      }
    },
  }));

  // Booking confirmation page
  Alpine.data('confirmation', () => ({
    booking: null as any,
    loading: true,
    error: null as string | null,

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
      } catch (err: any) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },
  }));
};
