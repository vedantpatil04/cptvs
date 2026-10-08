import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma, UserRole } from '../../generated/prisma/client.js';

export interface CreateUserData {
  username: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
}

/** Every principal is loaded with its parking-user summary (null for operational accounts). */
export const USER_WITH_PROFILE = {
  parkingProfile: { select: { category: true, verificationStatus: true } },
} as const satisfies Prisma.UserInclude;

export type UserWithProfile = Prisma.UserGetPayload<{ include: typeof USER_WITH_PROFILE }>;

export const userRepository = {
  findById(id: string, db: DbClient = prisma): Promise<UserWithProfile | null> {
    return db.user.findUnique({ where: { id }, include: USER_WITH_PROFILE });
  },

  /** `username` must already be normalised (see `normalizeUsername`). */
  findByUsername(username: string, db: DbClient = prisma): Promise<UserWithProfile | null> {
    return db.user.findUnique({ where: { username }, include: USER_WITH_PROFILE });
  },

  /** Parking users sign in with their (lower-cased) e-mail address. */
  async findParkingUserByEmail(
    email: string,
    db: DbClient = prisma,
  ): Promise<UserWithProfile | null> {
    const profile = await db.parkingUserProfile.findUnique({
      where: { email },
      select: { user: { include: USER_WITH_PROFILE } },
    });
    return profile?.user ?? null;
  },

  create(data: CreateUserData, db: DbClient = prisma) {
    return db.user.create({ data, include: USER_WITH_PROFILE });
  },

  recordLogin(id: string, at: Date, db: DbClient = prisma): Promise<UserWithProfile> {
    return db.user.update({
      where: { id },
      data: { lastLoginAt: at },
      include: USER_WITH_PROFILE,
    });
  },

  /** Revokes every access token previously issued to the user. */
  incrementTokenVersion(id: string, db: DbClient = prisma) {
    return db.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  },
};
