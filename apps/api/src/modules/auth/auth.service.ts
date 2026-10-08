import { normalizeUsername, type LoginRequest, type LoginResponse } from '@cpvts/shared';

import { withTransaction } from '../../db/transaction.js';
import { AppError, unauthenticated } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { toAuthenticatedUser, toAuthUser } from '../users/user.mapper.js';
import { userRepository } from '../users/user.repository.js';
import type { AuthContext, AuthenticatedUser, RequestMeta } from './auth.types.js';
import { simulatePasswordCheck, verifyPassword } from './password.js';
import { tokenService } from './token.service.js';

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'The username or password is incorrect.');

export const authService = {
  async login(input: LoginRequest, request: RequestMeta): Promise<LoginResponse> {
    const user = await userRepository.findByUsername(normalizeUsername(input.username));

    if (!user) {
      await simulatePasswordCheck(input.password);
      throw invalidCredentials();
    }

    if (!(await verifyPassword(input.password, user.passwordHash))) {
      await auditRepository.record({
        action: AUDIT_ACTIONS.authLoginFailed,
        actorId: user.id,
        entityType: AUDIT_ENTITY_TYPES.user,
        entityId: user.id,
        metadata: { reason: 'INVALID_PASSWORD' },
        request,
      });
      throw invalidCredentials();
    }

    if (!user.isActive) {
      await auditRepository.record({
        action: AUDIT_ACTIONS.authLoginFailed,
        actorId: user.id,
        entityType: AUDIT_ENTITY_TYPES.user,
        entityId: user.id,
        metadata: { reason: 'ACCOUNT_DISABLED' },
        request,
      });
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
    }

    const signedIn = await withTransaction(async (tx) => {
      const updated = await userRepository.recordLogin(user.id, new Date(), tx);
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.authLoginSucceeded,
          actorId: user.id,
          entityType: AUDIT_ENTITY_TYPES.user,
          entityId: user.id,
          request,
        },
        tx,
      );
      return updated;
    });

    const { token, expiresAt } = tokenService.issueAccessToken(signedIn.id, signedIn.tokenVersion);
    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresAt: expiresAt.toISOString(),
      user: toAuthUser(toAuthenticatedUser(signedIn)),
    };
  },

  /** Ends the session by revoking all of the user's outstanding access tokens. */
  async logout(user: AuthenticatedUser, request: RequestMeta): Promise<void> {
    await withTransaction(async (tx) => {
      await userRepository.incrementTokenVersion(user.id, tx);
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.authLogout,
          actorId: user.id,
          entityType: AUDIT_ENTITY_TYPES.user,
          entityId: user.id,
          request,
        },
        tx,
      );
    });
  },

  /** Resolves a bearer token to a currently valid, active user. */
  async authenticateToken(token: string | undefined): Promise<AuthContext> {
    if (!token) throw unauthenticated();

    const { userId, tokenVersion } = tokenService.verifyAccessToken(token);
    const user = await userRepository.findById(userId);

    if (!user || !user.isActive || user.tokenVersion !== tokenVersion) {
      throw unauthenticated('Your session is no longer valid. Please sign in again.');
    }
    return { user: toAuthenticatedUser(user) };
  },
};
