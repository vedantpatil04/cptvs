import { Router } from 'express';

import { authRouter } from '../modules/auth/auth.routes.js';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { adminRouter } from '../modules/management/admin.routes.js';
import { parkingRouter } from '../modules/parking/parking.routes.js';
import { publicRouter } from '../modules/public/public.routes.js';
import { systemRouter } from '../modules/system/system.routes.js';

/**
 * Version 1 of the CPVTS REST API, mounted at `/api/v1`.
 * Each module owns its router; register new modules here.
 */
export const apiV1Router = Router();

apiV1Router.use('/public', publicRouter);
apiV1Router.use('/auth', authRouter);
apiV1Router.use('/system', systemRouter);
apiV1Router.use('/parking', parkingRouter);
apiV1Router.use('/dashboard', dashboardRouter);
apiV1Router.use('/admin', adminRouter);
