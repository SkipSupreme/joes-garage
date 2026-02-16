import type { Alpine } from 'alpinejs';
import SignaturePad from 'signature_pad';

const API_URL = 'http://localhost:3001';

const SHOP_OPEN_HOUR = 9;
const SHOP_OPEN_MIN = 30; // 9:30 AM
const SHOP_CLOSE = 18; // 6 PM
const DURATION_HOURS: Record<string, number> = { '2h': 2, '4h': 4 };

export default (Alpine: Alpine) => {
  // Booking flow — multi-step rental booking
  Alpine.data('bookingFlow', () => ({
    step: 1,
    loading: false,
    globalError: null as string | null,
    dateError: null as string | null,
    waiverError: null as string | null,
    paymentError: null as string | null,

    // Step 1: Date + Duration + Time
    today: new Date().toISOString().split('T')[0],
    selectedDate: '',
    duration: '' as '' | '2h' | '4h' | '8h' | 'multi-day',
    startTime: '',
    endDate: '',

    // Step 2: Bikes + Cart
    bikes: [] as any[],
    cart: [] as Array<{ bike: any; quantity: number }>,
    reservationId: null as string | null,
    holdExpires: null as Date | null,
    holdCountdown: '',
    holdTimer: null as ReturnType<typeof setInterval> | null,

    // Step 3: Waiver
    waiver: {
      fullName: '',
      email: '',
      phone: '',
      dobMonth: '',
      dobDay: '',
      dobYear: '',
      consentElectronic: false,
      consentTerms: false,
    },
    signaturePad: null as any,

    // Computed
    get isHourly() {
      return this.duration === '2h' || this.duration === '4h';
    },
    get isFullDay() {
      return this.duration === '8h';
    },
    get durationLabel() {
      const labels: Record<string, string> = {
        '2h': '2 Hours',
        '4h': '4 Hours',
        '8h': 'Full Day',
        'multi-day': 'Multi-Day',
      };
      return labels[this.duration] || '';
    },
    get availableTimeSlots() {
      if (!this.isHourly || !this.duration) return [];
      const hours = DURATION_HOURS[this.duration];
      const slots: string[] = [];
      // Start at 9:30, then 10:00, 10:30, etc. — rental must end by 6 PM
      slots.push('09:30');
      for (let h = 10; h <= SHOP_CLOSE - hours; h++) {
        slots.push(`${String(h).padStart(2, '0')}:00`);
        if (h < SHOP_CLOSE - hours) {
          slots.push(`${String(h).padStart(2, '0')}:30`);
        }
      }
      return slots;
    },
    get canCheckAvailability() {
      if (!this.selectedDate || !this.duration) return false;
      if (this.duration === 'multi-day') return !!this.endDate && !this.dateError;
      if (this.isFullDay) return !this.dateError;
      return !!this.startTime && !this.dateError;
    },
    get rentalDays() {
      if (this.duration !== 'multi-day' || !this.selectedDate || !this.endDate) return 0;
      const start = new Date(this.selectedDate);
      const end = new Date(this.endDate);
      return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    },

    // Cart methods
    addToCart(bike: any) {
      const existing = this.cart.find((item: any) => item.bike.id === bike.id);
      if (existing) {
        if (existing.quantity < bike.available_count) existing.quantity++;
      } else {
        this.cart.push({ bike, quantity: 1 });
      }
    },

    removeFromCart(bikeId: number) {
      const idx = this.cart.findIndex((item: any) => item.bike.id === bikeId);
      if (idx !== -1) {
        if (this.cart[idx].quantity > 1) this.cart[idx].quantity--;
        else this.cart.splice(idx, 1);
      }
    },

    getCartQuantity(bikeId: number): number {
      return this.cart.find((item: any) => item.bike.id === bikeId)?.quantity || 0;
    },

    getRentalPriceForBike(bike: any): number {
      if (this.duration === '2h') return parseFloat(bike.price2h) || 0;
      if (this.duration === '4h') return parseFloat(bike.price4h) || 0;
      if (this.duration === '8h') return parseFloat(bike.price8h) || 0;
      // multi-day: first day at full-day rate, additional days at per-day rate
      const firstDay = parseFloat(bike.price8h) || 0;
      const additionalRate = parseFloat(bike.price_per_day) || 0;
      return firstDay + additionalRate * Math.max(0, this.rentalDays - 1);
    },

    get cartItemCount() {
      return this.cart.reduce((sum: number, item: any) => sum + item.quantity, 0);
    },

    get cartTotalRental() {
      return this.cart.reduce((sum: number, item: any) => {
        const price = this.getRentalPriceForBike(item.bike);
        return sum + price * item.quantity;
      }, 0);
    },

    get cartTotalDeposit() {
      return this.cart.reduce((sum: number, item: any) => {
        return sum + (parseFloat(item.bike.deposit_amount) || 0) * item.quantity;
      }, 0);
    },

    get cartTotal() {
      return this.cartTotalRental + this.cartTotalDeposit;
    },
    get dobMonths() {
      return ['January','February','March','April','May','June','July','August','September','October','November','December'];
    },
    get dobDays() {
      const m = parseInt(this.waiver.dobMonth);
      const y = parseInt(this.waiver.dobYear) || 2000;
      if (!m) return Array.from({ length: 31 }, (_, i) => i + 1);
      return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => i + 1);
    },
    get dobYears() {
      const now = new Date().getFullYear();
      // 16 to 100 years ago (must be 18+ but allow 16 for guardian consent per waiver clause 7)
      const years: number[] = [];
      for (let y = now - 16; y >= now - 100; y--) years.push(y);
      return years;
    },
    get dateOfBirth() {
      const { dobYear, dobMonth, dobDay } = this.waiver;
      if (!dobYear || !dobMonth || !dobDay) return '';
      return `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`;
    },

    formatTime(slot: string) {
      const [h] = slot.split(':').map(Number);
      const suffix = h >= 12 ? 'PM' : 'AM';
      const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const mins = slot.split(':')[1];
      return mins === '00' ? `${display} ${suffix}` : `${display}:${mins} ${suffix}`;
    },

    init() {
      this.$watch('selectedDate', () => this.validateDates());
      this.$watch('endDate', () => this.validateDates());
      this.$watch('duration', (val: string) => {
        // Reset time/endDate when switching duration type
        this.endDate = '';
        // Full Day auto-sets to shop hours (9:30 AM – 6 PM)
        this.startTime = val === '8h' ? '09:30' : '';
        this.dateError = null;
      });

      // Initialize signature pad when waiver step becomes visible
      this.$watch('step', (val: number) => {
        if (val === 3 && !this.signaturePad) {
          // Wait one tick for x-show to make the canvas visible
          this.$nextTick(() => {
            const canvas = document.getElementById('signature-pad') as HTMLCanvasElement | null;
            if (canvas) {
              const ratio = window.devicePixelRatio || 1;
              canvas.width = canvas.offsetWidth * ratio;
              canvas.height = canvas.offsetHeight * ratio;
              canvas.getContext('2d')!.scale(ratio, ratio);

              this.signaturePad = new SignaturePad(canvas, {
                backgroundColor: 'rgb(255, 255, 255)',
                penColor: 'rgb(30, 30, 30)',
              });
            }
          });
        }
      });
    },

    validateDates() {
      this.dateError = null;
      if (!this.selectedDate) return;

      const start = new Date(this.selectedDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (start < today) {
        this.dateError = 'Date must be today or later.';
        return;
      }

      if (this.duration === 'multi-day' && this.endDate) {
        const end = new Date(this.endDate);
        if (end < start) {
          this.dateError = 'End date must be on or after start date.';
        } else if (this.rentalDays > 30) {
          this.dateError = 'Maximum rental duration is 30 days.';
        }
      }
    },

    async checkAvailability() {
      this.loading = true;
      this.globalError = null;
      try {
        let url = `${API_URL}/api/availability?date=${this.selectedDate}&duration=${this.duration}`;
        if (this.duration === 'multi-day') {
          url += `&endDate=${this.endDate}`;
        } else {
          url += `&startTime=${this.startTime}`;
        }
        const res = await fetch(url);
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

    async holdCart() {
      if (this.cart.length === 0) return;
      this.loading = true;
      this.globalError = null;

      try {
        // Build bikes array: expand quantities into individual bike IDs
        const bikes: { bikeId: number }[] = [];
        for (const item of this.cart) {
          // Each bike group has bike_ids array with available individual bike IDs
          const availableIds = item.bike.bike_ids || [item.bike.id];
          for (let i = 0; i < item.quantity; i++) {
            if (i < availableIds.length) {
              bikes.push({ bikeId: availableIds[i] });
            }
          }
        }

        const body: any = {
          bikes,
          date: this.selectedDate,
          duration: this.duration,
        };
        if (this.duration === 'multi-day') {
          body.endDate = this.endDate;
        } else if (this.isHourly) {
          body.startTime = this.startTime;
        }

        const res = await fetch(`${API_URL}/api/bookings/hold`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reserve bikes');

        this.reservationId = data.reservationId;
        this.holdExpires = new Date(data.holdExpiresAt);
        this.startHoldTimer();
        this.step = 3;
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

      if (!this.signaturePad) {
        this.waiverError = 'Signature pad failed to load. Please refresh the page.';
        this.loading = false;
        return;
      }
      if (this.signaturePad.isEmpty()) {
        this.waiverError = 'Please draw your signature.';
        this.loading = false;
        return;
      }
      const signatureDataUrl = this.signaturePad.toDataURL('image/png');

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
            dateOfBirth: this.dateOfBirth,
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

    get durationLabel() {
      const b = this.booking as any;
      if (!b?.duration_type) return '';
      const labels: Record<string, string> = {
        '2h': '2 Hours',
        '4h': '4 Hours',
        '8h': 'Full Day',
        'multi-day': 'Multi-Day',
      };
      return labels[b.duration_type] || b.duration_type;
    },

    formatPeriod(periodStr: string) {
      if (!periodStr) return 'N/A';
      // tstzrange: ["2026-02-27 20:00:00+00","2026-02-27 22:00:00+00")
      // Strip brackets/parens, split on comma, strip quotes
      const cleaned = periodStr.replace(/^[\[(]|[\])]$/g, '');
      const parts = cleaned.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      if (parts.length !== 2) return periodStr;
      const start = new Date(parts[0]);
      const end = new Date(parts[1]);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return periodStr;
      const opts: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Edmonton',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      };
      // If same day, just show date once with time range
      const dateOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', weekday: 'short' };
      const timeOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/Edmonton', hour: 'numeric', minute: '2-digit' };
      if (start.toLocaleDateString('en-CA', dateOpts) === end.toLocaleDateString('en-CA', dateOpts)) {
        return `${start.toLocaleDateString('en-CA', dateOpts)}, ${start.toLocaleTimeString('en-CA', timeOpts)} – ${end.toLocaleTimeString('en-CA', timeOpts)}`;
      }
      return `${start.toLocaleString('en-CA', opts)} – ${end.toLocaleString('en-CA', opts)}`;
    },
  }));

  // QR waiver page — group members sign their waivers here
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
      const labels: Record<string, string> = { '2h': '2 Hours', '4h': '4 Hours', '8h': 'Full Day', 'multi-day': 'Multi-Day' };
      return labels[this.booking.duration_type] || this.booking.duration_type;
    },
    get dobMonths() {
      return ['January','February','March','April','May','June','July','August','September','October','November','December'];
    },
    get dobDays() {
      const m = parseInt(this.waiver.dobMonth);
      const y = parseInt(this.waiver.dobYear) || 2000;
      if (!m) return Array.from({ length: 31 }, (_, i) => i + 1);
      return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => i + 1);
    },
    get dobYears() {
      const now = new Date().getFullYear();
      const years: number[] = [];
      for (let y = now - 16; y >= now - 100; y--) years.push(y);
      return years;
    },
    get dateOfBirth() {
      const { dobYear, dobMonth, dobDay } = this.waiver;
      if (!dobYear || !dobMonth || !dobDay) return '';
      return `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`;
    },

    init() {
      // Read the reservation ref from the data attribute set in the Astro template
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
        const res = await fetch(`${API_URL}/api/bookings/${this.ref}`);
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

      // Initialize signature pad after booking loads
      if (!this.error && !this.allSigned) {
        this.$nextTick(() => {
          const canvas = document.getElementById('waiver-signature-pad') as HTMLCanvasElement | null;
          if (canvas) {
            const ratio = window.devicePixelRatio || 1;
            canvas.width = canvas.offsetWidth * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d')!.scale(ratio, ratio);
            this.signaturePad = new SignaturePad(canvas, {
              backgroundColor: 'rgb(255, 255, 255)',
              penColor: 'rgb(30, 30, 30)',
            });
          }
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
          reservationId: this.ref,
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

        // Reset form
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

        // Refresh booking to update waiver list
        await this.fetchBooking();
      } catch (err: any) {
        this.error = err.message;
      } finally {
        this.submitting = false;
      }
    },
  }));
};
