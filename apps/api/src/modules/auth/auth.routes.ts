import { loginRequestSchema } from '@cpvts/shared';
import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { loginRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { authController } from './auth.controller.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  loginRateLimiter,
  validate({ body: loginRequestSchema }),
  authController.login,
);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.me);
