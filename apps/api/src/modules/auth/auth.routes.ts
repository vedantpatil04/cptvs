import {
  loginRequestSchema,
  registrationRequestSchema,
  userLoginRequestSchema,
} from '@cpvts/shared';
import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { loginRateLimiter, registrationRateLimiter } from '../../middleware/rate-limit.js';
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

// Parking users (Student / Campus Staff) sign in and register through their own door.
authRouter.post(
  '/user-login',
  loginRateLimiter,
  validate({ body: userLoginRequestSchema }),
  authController.userLogin,
);
authRouter.post(
  '/register/student',
  registrationRateLimiter,
  validate({ body: registrationRequestSchema }),
  authController.register('STUDENT'),
);
authRouter.post(
  '/register/staff',
  registrationRateLimiter,
  validate({ body: registrationRequestSchema }),
  authController.register('STAFF'),
);
