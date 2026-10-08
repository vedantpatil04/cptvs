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
 * features wait for approval.
 */
export const requireVerified: RequestHandler = (req, _res, next) => {
  const { user } = requireAuth(req);
  if (user.parkingUser?.verificationStatus !== 'VERIFIED') {
    next(accountErrors.verificationRequired());
    return;
  }
  next();
};

/** The verified account's category: the single source of the billing category. */
export const accountCategory = (user: AuthenticatedUser) => {
  if (user.parkingUser?.verificationStatus !== 'VERIFIED') {
    throw accountErrors.verificationRequired();
  }
  return user.parkingUser.category;
};

/**
 * Sessions a user may see: those of their own vehicles that began after they
 * registered the vehicle (a new owner never sees a previous owner's history).
 * Every portal read and action goes through this single scope.
 */
export const ownedSessionWhere = async (
  userId: string,
  db: Pick<typeof prisma, 'vehicle'> = prisma,
): Promise<Prisma.ParkingSessionWhereInput> => {
  const vehicles = await db.vehicle.findMany({
    where: { ownerUserId: userId },
    select: { id: true, ownerSince: true },
  });
  if (vehicles.length === 0) return { id: { in: [] } };
  return {
    OR: vehicles.map((vehicle) => ({
      vehicleId: vehicle.id,
      entryAt: { gte: vehicle.ownerSince ?? new Date(0) },
    })),
  };
};

/** The user's session, or "not found" — never a hint that someone else's session exists. */
export const findOwnSession = async (userId: string, sessionNumber: string) => {
  const session = await prisma.parkingSession.findFirst({
    where: { sessionNumber, ...(await ownedSessionWhere(userId)) },
    include: SESSION_INCLUDE,
  });
  if (!session) throw parkingErrors.sessionNotFound();
  return session;
};
