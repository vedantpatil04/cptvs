import {
  isOperationalRole,
  normalizeUsername,
  type LoginRequest,
  type LoginResponse,
  type UserLoginRequest,
  type UserRole,
} from '@cpvts/shared';

import type { DbClient } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { AppError, unauthenticated } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { toAuthenticatedUser, toAuthUser } from '../users/user.mapper.js';
import { userRepository, type UserWithProfile } from '../users/user.repository.js';
import type { AuthContext, AuthenticatedUser, RequestMeta } from './auth.types.js';
import { simulatePasswordCheck, verifyPassword } from './password.js';
import { tokenService } from './token.service.js';

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'The username or password is incorrect.');

/**
 * Checks the password and account state, then issues a token. `accepts`
 * decides which roles may use this sign-in door; any other account is treated
 * exactly like an unknown one, so the two doors reveal nothing about each other.
 */
const signIn = async (
  user: UserWithProfile | null,
  password: string,
  accepts: (role: UserRole) => boolean,
  request: RequestMeta,
): Promise<LoginResponse> => {
  if (!user || !accepts(user.role)) {
    await simulatePasswordCheck(password);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
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

  const signedIn = await withTransaction((tx) => recordSignIn(user.id, request, tx));
  return issueSession(signedIn);
};

const recordSignIn = async (userId: string, request: RequestMeta, db: DbClient) => {
  const updated = await userRepository.recordLogin(userId, new Date(), db);
  await auditRepository.record(
    {
      action: AUDIT_ACTIONS.authLoginSucceeded,
      actorId: userId,
      entityType: AUDIT_ENTITY_TYPES.user,
      entityId: userId,
      request,
    },
    db,
  );
  return updated;
};

const issueSession = (user: UserWithProfile): LoginResponse => {
  const { token, expiresAt } = tokenService.issueAccessToken(user.id, user.tokenVersion);
  return {
    accessToken: token,
    tokenType: 'Bearer',
    expiresAt: expiresAt.toISOString(),
    user: toAuthUser(toAuthenticatedUser(user)),
  };
};

export const authService = {
  /** Security Staff and Administrator sign-in (username + password). */
  async login(input: LoginRequest, request: RequestMeta): Promise<LoginResponse> {
    const user = await userRepository.findByUsername(normalizeUsername(input.username));
    return signIn(user, input.password, isOperationalRole, request);
  },

  /** Student / Campus Staff sign-in (e-mail + password). */
  async userLogin(input: UserLoginRequest, request: RequestMeta): Promise<LoginResponse> {
    const user = await userRepository.findParkingUserByEmail(input.email);
    return signIn(user, input.password, (role) => role === 'PARKING_USER', request);
  },

  /** Signs in a freshly registered account inside the registration transaction. */
  async startSession(userId: string, request: RequestMeta, db: DbClient): Promise<LoginResponse> {
    return issueSession(await recordSignIn(userId, request, db));
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
