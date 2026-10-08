import type { CurrentUserResponse, LoginRequest } from '@cpvts/shared';
import type { RequestHandler } from 'express';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { toAuthUser } from '../users/user.mapper.js';
import { authService } from './auth.service.js';

export const authController = {
  login: (async (req, res) => {
    const result = await authService.login(req.body as LoginRequest, requestMeta(req));
    res.status(200).json(result);
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
