import type { Alpine } from 'alpinejs';
import { registerBookingFlow } from './alpine/booking-flow';
import { registerConfirmation } from './alpine/confirmation';
import { registerWaiverPage } from './alpine/waiver-page';
import { registerStandaloneWaiver } from './alpine/standalone-waiver';

export default (Alpine: Alpine) => {
  // Conditionally register data objects based on which page elements exist.
  // This avoids defining unused Alpine data on pages that don't need it.
  const path = window.location.pathname;

  if (path.startsWith('/book/confirmation')) {
    registerConfirmation(Alpine);
  } else if (path.startsWith('/book')) {
    registerBookingFlow(Alpine);
  }

  if (path.startsWith('/waiver/') && path.length > '/waiver/'.length) {
    // /waiver/[ref] — group waiver signing page
    registerWaiverPage(Alpine);
  } else if (path === '/waiver' || path === '/waiver/') {
    // /waiver — standalone walk-up waiver
    registerStandaloneWaiver(Alpine);
  }
};
