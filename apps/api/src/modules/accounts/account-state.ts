import {
  parkNowEligibilityOf,
  toAcademicProfileView,
  type AcademicProfileView,
  type AcademicProgram as SharedProgram,
  type ParkingAccountState,
  type VerificationInfo,
} from '@cpvts/shared';

import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type {
  AcademicProgram as DbProgram,
  ParkingUserProfile,
} from '../../generated/prisma/client.js';
import { accountErrors } from './accounts.errors.js';

// Compile-time guarantee that the database enum and the shared contract agree.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const programsMatch: Equals<DbProgram, SharedProgram> = true;
void programsMatch;

/** The academic columns of a profile row (all four are set together or not at all). */
type AcademicColumns = Pick<
  ParkingUserProfile,
  'program' | 'department' | 'admissionYear' | 'currentSemester'
>;

/** The academic profile of a student, or null when none has been recorded. */
export const academicViewOf = (profile: AcademicColumns): AcademicProfileView | null =>
  profile.program !== null &&
  profile.department !== null &&
  profile.admissionYear !== null &&
  profile.currentSemester !== null
    ? toAcademicProfileView({
        program: profile.program,
        department: profile.department,
        admissionYear: profile.admissionYear,
        currentSemester: profile.currentSemester,
      })
    : null;

export const verificationInfoOf = (
  profile: Pick<
    ParkingUserProfile,
    'verificationStatus' | 'verificationNote' | 'verificationSubmittedAt' | 'reviewedAt'
  >,
): VerificationInfo => ({
  status: profile.verificationStatus,
  note: profile.verificationNote,
  submittedAt: profile.verificationSubmittedAt.toISOString(),
  reviewedAt: profile.reviewedAt?.toISOString() ?? null,
});

/**
 * The account state, read straight from the database. This is the one place a profile row
 * becomes "what may this account do" — the same record Admin edits when it approves or
 * rejects a verification — so the answer is never older than the request that asks for it.
 */
export const accountStateService = {
  async get(userId: string, db: DbClient = prisma): Promise<ParkingAccountState> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, parkingProfile: true },
    });
    const profile = user?.parkingProfile;
    if (!user || !profile) throw accountErrors.userNotFound();
    return {
      userId: user.id,
      category: profile.category,
      isActive: user.isActive,
      verification: verificationInfoOf(profile),
      parkNow: parkNowEligibilityOf(profile.verificationStatus, user.isActive),
      academic: academicViewOf(profile),
      asOf: new Date().toISOString(),
    };
  },
};
