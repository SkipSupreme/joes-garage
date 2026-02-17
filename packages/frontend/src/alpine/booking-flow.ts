import type { Alpine } from 'alpinejs';
import { DURATION_HOURS, DURATION_LABELS } from '@joes-garage/shared/constants';
import {
  API_URL, SHOP_CLOSE, DOB_MONTHS,
  getDobDays, getDobYears, formatDateOfBirth,
  createSignaturePad, loadFlatpickr,
} from './shared';

export function registerBookingFlow(Alpine: Alpine) {
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
    bookingRef: null as string | null,
    bookingToken: null as string | null,
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
      return DURATION_LABELS[this.duration] || '';
    },
    get availableTimeSlots() {
      if (!this.isHourly || !this.duration) return [];
      const hours = DURATION_HOURS[this.duration];
      const slots: string[] = [];
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
    get dobMonths() { return DOB_MONTHS; },
    get dobDays() { return getDobDays(this.waiver.dobMonth, this.waiver.dobYear); },
    get dobYears() { return getDobYears(); },
    get dateOfBirth() { return formatDateOfBirth(this.waiver.dobYear, this.waiver.dobMonth, this.waiver.dobDay); },

    formatTime(slot: string) {
      const [h] = slot.split(':').map(Number);
      const suffix = h >= 12 ? 'PM' : 'AM';
      const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const mins = slot.split(':')[1];
      return mins === '00' ? `${display} ${suffix}` : `${display}:${mins} ${suffix}`;
    },

    startDatePicker: null as any,
    endDatePicker: null as any,

    init() {
      this.$watch('selectedDate', () => this.validateDates());
      this.$watch('endDate', () => this.validateDates());
      this.$watch('duration', (val: string) => {
        this.endDate = '';
        this.startTime = val === '8h' ? '09:30' : '';
        this.dateError = null;

        if (val === 'multi-day') {
          this.$nextTick(() => this.initEndDatePicker());
        }
      });

      this.$watch('step', (val: number) => {
        if (val === 3 && !this.signaturePad) {
          this.$nextTick(() => {
            this.signaturePad = createSignaturePad('signature-pad');
          });
        }
      });

      this.$nextTick(() => this.initStartDatePicker());
    },

    async initStartDatePicker() {
      const el = document.getElementById('ride-date');
      if (!el || this.startDatePicker) return;
      const fp = await loadFlatpickr();
      this.startDatePicker = fp(el, {
        dateFormat: 'Y-m-d',
        minDate: 'today',
        disableMobile: true,
        onChange: (selectedDates: Date[]) => {
          if (selectedDates.length) {
            this.selectedDate = selectedDates[0].toISOString().split('T')[0];
            if (this.endDatePicker) {
              this.endDatePicker.set('minDate', this.selectedDate);
            }
          }
        },
      });
    },

    async initEndDatePicker() {
      const el = document.getElementById('end-date');
      if (!el || this.endDatePicker) return;
      const fp = await loadFlatpickr();
      this.endDatePicker = fp(el, {
        dateFormat: 'Y-m-d',
        minDate: this.selectedDate || 'today',
        disableMobile: true,
        onChange: (selectedDates: Date[]) => {
          if (selectedDates.length) {
            this.endDate = selectedDates[0].toISOString().split('T')[0];
          }
        },
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
        const bikes: { bikeId: number }[] = [];
        for (const item of this.cart) {
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
        this.bookingRef = data.bookingRef || null;
        this.bookingToken = data.bookingToken || null;
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
      if (this.holdTimer) clearInterval(this.holdTimer);
      try {
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

        const tokenParam = data.bookingToken ? `&token=${data.bookingToken}` : '';
        window.location.href = `/book/confirmation?id=${data.bookingId}${tokenParam}`;
      } catch (err: any) {
        this.paymentError = err.message;
      } finally {
        this.loading = false;
      }
    },
  }));
}
