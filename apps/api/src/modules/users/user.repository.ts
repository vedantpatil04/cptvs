import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { User, UserRole } from '../../generated/prisma/client.js';

export interface CreateUserData {
  username: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
}

export const userRepository = {
  findById(id: string, db: DbClient = prisma): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  },

  /** `username` must already be normalised (see `normalizeUsername`). */
  findByUsername(username: string, db: DbClient = prisma): Promise<User | null> {
    return db.user.findUnique({ where: { username } });
  },

  create(data: CreateUserData, db: DbClient = prisma): Promise<User> {
    return db.user.create({ data });
  },

  recordLogin(id: string, at: Date, db: DbClient = prisma): Promise<User> {
    return db.user.update({ where: { id }, data: { lastLoginAt: at } });
  },

  /** Revokes every access token previously issued to the user. */
  incrementTokenVersion(id: string, db: DbClient = prisma): Promise<User> {
    return db.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  },
};
