import { expect, test } from '@playwright/test';

test('booking flow reaches waiver step', async ({ page }) => {
  await page.route('**/api/availability**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        bikes: [
          {
            id: 101,
            name: 'Test Cruiser',
            type: 'cruiser',
            size: 'm',
            bike_ids: [101],
            available_count: 1,
            rental_price: '40.00',
            price2h: '20.00',
            price4h: '30.00',
            price8h: '40.00',
            price_per_day: '25.00',
            deposit_amount: '100.00',
            photo_url: null,
            photo_alt: null,
          },
        ],
      }),
    });
  });

  await page.route('**/api/bookings/hold', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        reservationId: '11111111-1111-1111-1111-111111111111',
        bookingRef: 'ABC123',
        bookingToken: 'token12345678',
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    });
  });

  await page.goto('/book');

  await page.waitForSelector('[x-data="bookingFlow"]');
  await page.waitForFunction(() => {
    const root = document.querySelector('[x-data="bookingFlow"]') as any;
    return !!root?._x_dataStack?.[0];
  });
  await page.evaluate(async () => {
    const root = document.querySelector('[x-data="bookingFlow"]') as any;
    const data = root._x_dataStack[0];
    data.duration = '4h';
    data.selectedDate = '2026-02-27';
    data.startTime = '10:30';
    data.dateError = null;
    await data.checkAvailability();
  });

  await expect(page.getByRole('heading', { name: 'Choose your bikes' })).toBeVisible();
  await page.evaluate(async () => {
    const root = document.querySelector('[x-data="bookingFlow"]') as any;
    const data = root._x_dataStack[0];
    data.cart = [{ bike: data.bikes[0], quantity: 1 }];
    await data.holdCart();
  });

  await expect(page.getByRole('heading', { name: 'Sign the Waiver' })).toBeVisible();
});

test('home page renders hero CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Book a Rental/i }).first()).toBeVisible();
});
