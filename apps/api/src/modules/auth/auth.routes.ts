import {
  loginRequestSchema,
  registrationRequestSchema,
  studentRegistrationRequestSchema,
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
// Student / Campus Staff: a separate door from the operational sign-in above.
authRouter.post(
  '/user-login',
  loginRateLimiter,
  validate({ body: userLoginRequestSchema }),
  authController.userLogin,
);
authRouter.post(
  '/register/student',
  registrationRateLimiter,
  validate({ body: studentRegistrationRequestSchema }),
  authController.register('STUDENT'),
);
authRouter.post(
  '/register/staff',
  registrationRateLimiter,
  validate({ body: registrationRequestSchema }),
  authController.register('STAFF'),
);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.me);
