import type {
  CurrentUserResponse,
  LoginRequest,
  ParkingUserCategory,
  UserLoginRequest,
} from '@cpvts/shared';
import type { RequestHandler } from 'express';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { registrationService } from '../accounts/registration.service.js';
import { toAuthUser } from '../users/user.mapper.js';
import { authService } from './auth.service.js';

export const authController = {
  login: (async (req, res) => {
    const result = await authService.login(req.body as LoginRequest, requestMeta(req));
    res.status(200).json(result);
  }) satisfies RequestHandler,

  userLogin: (async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res
      .status(200)
      .json(await authService.userLogin(req.body as UserLoginRequest, requestMeta(req)));
  }) satisfies RequestHandler,

  /** The category comes from the route, never from the request body. */
  register: (category: ParkingUserCategory) =>
    (async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const result = await registrationService.register(
        category,
        req.body as Parameters<typeof registrationService.register>[1],
        requestMeta(req),
      );
      res.status(201).json(result);
    }) satisfies RequestHandler,

  logout: (async (req, res) => {
    await authService.logout(requireAuth(req).user, requestMeta(req));
    res.status(204).end();
  }) satisfies RequestHandler,

  me: ((req, res) => {
    const body: CurrentUserResponse = { user: toAuthUser(requireAuth(req).user) };
    res.status(200).json(body);
  }) satisfies RequestHandler,
};
