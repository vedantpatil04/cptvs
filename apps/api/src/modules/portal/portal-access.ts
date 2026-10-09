import type { RequestHandler } from 'express';

import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { requireAuth } from '../../lib/request-context.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { SESSION_INCLUDE } from '../parking/parking.repository.js';

/**
 * Requires a Student / Campus Staff account whose identity verification has
 * been approved. Use after `authenticate` and `authorize('PARKING_USER')`.
 * Pending and rejected accounts can sign in and see their status, but parking
 * features wait for approval. The decision uses the account state `authenticate`
 * read from the database on this very request — never the token.
 */
export const requireVerified: RequestHandler = (req, _res, next) => {
  const { user } = requireAuth(req);
  if (!user.parkingUser?.parkNow.eligible) {
    next(accountErrors.verificationRequired());
    return;
  }
  next();
};

/** The verified account's category: the single source of the billing category. */
export const accountCategory = (user: AuthenticatedUser) => {
  if (!user.parkingUser?.parkNow.eligible) {
    throw accountErrors.verificationRequired();
  }
  return user.parkingUser.category;
};

/**
 * Sessions a user may see: exactly those that carry their account as the owner of the
 * vehicle when the session began. A later owner of the same plate never sees them, and the
 * previous owner keeps them after releasing the vehicle. Every portal read and action goes
 * through this single scope.
 */
export const ownedSessionWhere = (userId: string): Prisma.ParkingSessionWhereInput => ({
  ownerUserId: userId,
});

/** The user's session, or "not found" — never a hint that someone else's session exists. */
export const findOwnSession = async (userId: string, sessionNumber: string) => {
  const session = await prisma.parkingSession.findFirst({
    where: { sessionNumber, ...ownedSessionWhere(userId) },
    include: SESSION_INCLUDE,
  });
  if (!session) throw parkingErrors.sessionNotFound();
  return session;
};
