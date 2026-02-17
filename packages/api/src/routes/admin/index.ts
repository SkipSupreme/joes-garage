import { type Router as IRouter, Router } from 'express';
import { dashboardRouter } from './dashboard.js';
import { bookingsRouter } from './bookings.js';
import { actionsRouter } from './actions.js';
import { walkInRouter } from './walk-in.js';
import { fleetRouter } from './fleet.js';
import { waiversRouter } from './waivers.js';
import { paymentsRouter } from './payments.js';
import { notesRouter } from './notes.js';

export const adminRouter: IRouter = Router();

adminRouter.use(dashboardRouter);
adminRouter.use(bookingsRouter);
adminRouter.use(actionsRouter);
adminRouter.use(walkInRouter);
adminRouter.use(fleetRouter);
adminRouter.use(waiversRouter);
adminRouter.use(paymentsRouter);
adminRouter.use(notesRouter);
