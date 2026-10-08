import { Router } from 'express';

import { authRouter } from '../modules/auth/auth.routes.js';
import { systemRouter } from '../modules/system/system.routes.js';

/**
 * Version 1 of the CPVTS REST API, mounted at `/api/v1`.
 * Each module owns its router; register new modules here.
 */
export const apiV1Router = Router();

apiV1Router.use('/auth', authRouter);
apiV1Router.use('/system', systemRouter);
