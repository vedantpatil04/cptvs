import type {
  CreateSecurityStaffRequest,
  ResetPasswordRequest,
  SecurityStaffMember,
} from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { conflict } from '../../lib/errors.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { hashPassword } from '../auth/password.js';
import type { OperationContext } from '../parking/operation-context.js';
import { userRepository } from '../users/user.repository.js';
import { isOnDuty } from './shift-policy.js';

const STAFF_SELECT = {
  id: true,
  fullName: true,
  username: true,
  isActive: true,
  lastLoginAt: true,
  // Open shifts only: enough to tell who is on duty right now.
  shifts: {
    where: { status: { in: ['CHECKED_IN', 'ACTIVE'] } },
    select: {
      id: true,
      shiftName: true,
      startsAt: true,
      endsAt: true,
      gate: true,
      status: true,
      checkedInAt: true,
      checkedOutAt: true,
    },
  },
} as const satisfies Prisma.UserSelect;

type StaffRow = Prisma.UserGetPayload<{ select: typeof STAFF_SELECT }>;

const toMember = (user: StaffRow, now: Date): SecurityStaffMember => {
  const onDuty = user.shifts.find((shift) => isOnDuty(shift, now));
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    onDutyShift: onDuty
      ? {
          id: onDuty.id,
          name: onDuty.shiftName,
          endsAt: onDuty.endsAt.toISOString(),
          gate: onDuty.gate,
        }
      : null,
  };
};

/**
 * Security Staff accounts. Administrators create them (guards cannot register themselves),
 * deactivate them with the general user-status control, and reset their passwords.
 */
export const securityStaffService = {
  async list(): Promise<SecurityStaffMember[]> {
    const now = new Date();
    const staff = await prisma.user.findMany({
      where: { role: 'SECURITY_STAFF' },
      select: STAFF_SELECT,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });
    return staff.map((user) => toMember(user, now));
  },

  async create(
    input: CreateSecurityStaffRequest & { username: string; fullName: string; password: string },
    context: OperationContext,
  ): Promise<SecurityStaffMember> {
    const passwordHash = await hashPassword(input.password);
    try {
      const id = await withTransaction(async (tx) => {
        const user = await userRepository.create(
          {
            username: input.username,
            fullName: input.fullName,
            role: 'SECURITY_STAFF',
            passwordHash,
          },
          tx,
        );
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.securityStaffCreated,
            actorId: context.actor.id,
            entityType: AUDIT_ENTITY_TYPES.user,
            entityId: user.id,
            metadata: { username: user.username },
            request: context.request,
          },
          tx,
        );
        return user.id;
      });
      return (await this.list()).find((member) => member.id === id)!;
    } catch (error) {
      if (isUniqueViolation(error, 'users_username_key')) {
        throw conflict('This username is already taken.');
      }
      throw error;
    }
  },

  /** Sets a new password and signs the person out everywhere (their tokens stop working). */
  async resetPassword(
    id: string,
    input: ResetPasswordRequest & { password: string },
    context: OperationContext,
  ): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    await withTransaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, role: 'SECURITY_STAFF' } });
      if (!user) throw accountErrors.userNotFound();
      await tx.user.update({
        where: { id },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.passwordReset,
          actorId: context.actor.id,
          entityType: AUDIT_ENTITY_TYPES.user,
          entityId: id,
          request: context.request,
        },
        tx,
      );
    });
  },
};
