import type { ParkingUserProfileView, ProfileUpdate } from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import type { OperationContext } from '../parking/operation-context.js';

const loadProfile = async (userId: string): Promise<ParkingUserProfileView> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { parkingProfile: true, _count: { select: { vehicles: true } } },
  });
  const profile = user?.parkingProfile;
  if (!user || !profile) throw accountErrors.userNotFound();
  return {
    id: user.id,
    fullName: user.fullName,
    email: profile.email,
    phone: profile.phone,
    category: profile.category,
    institutionalId: profile.institutionalId,
    verification: {
      status: profile.verificationStatus,
      note: profile.verificationNote,
      submittedAt: profile.verificationSubmittedAt.toISOString(),
      reviewedAt: profile.reviewedAt?.toISOString() ?? null,
    },
    preferredLocale: profile.preferredLocale,
    vehicleCount: user._count.vehicles,
    memberSince: user.createdAt.toISOString(),
  };
};

export const profileService = {
  get: loadProfile,

  /** Name, phone and language only: category, ID, e-mail and verification are not self-editable. */
  async update(update: ProfileUpdate, context: OperationContext): Promise<ParkingUserProfileView> {
    const userId = context.actor.id;
    await withTransaction(async (tx) => {
      const changed: string[] = [];
      if (update.fullName !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { fullName: update.fullName } });
        changed.push('fullName');
      }
      if (update.phone !== undefined || update.preferredLocale !== undefined) {
        await tx.parkingUserProfile.update({
          where: { userId },
          data: {
            ...(update.phone !== undefined ? { phone: update.phone } : {}),
            ...(update.preferredLocale !== undefined
              ? { preferredLocale: update.preferredLocale }
              : {}),
          },
        });
        if (update.phone !== undefined) changed.push('phone');
        if (update.preferredLocale !== undefined) changed.push('preferredLocale');
      }
      if (changed.length > 0) {
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.profileUpdated,
            actorId: userId,
            entityType: AUDIT_ENTITY_TYPES.user,
            entityId: userId,
            metadata: { fields: changed },
            request: context.request,
          },
          tx,
        );
      }
    });
    return loadProfile(userId);
  },
};
