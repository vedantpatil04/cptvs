import { compare, hash } from 'bcryptjs';

/** bcrypt work factor. 12 rounds ≈ 200–300 ms on typical server hardware. */
const BCRYPT_ROUNDS = 12;

export const hashPassword = (plain: string): Promise<string> => hash(plain, BCRYPT_ROUNDS);

export const verifyPassword = (plain: string, passwordHash: string): Promise<boolean> =>
  compare(plain, passwordHash);

let dummyHash: Promise<string> | undefined;

/**
 * Performs a full-cost comparison against a throwaway hash. Used when the
 * username does not exist so that response timing does not reveal whether an
 * account exists.
 */
export const simulatePasswordCheck = async (plain: string): Promise<void> => {
  dummyHash ??= hash('cpvts-timing-equaliser', BCRYPT_ROUNDS);
  await compare(plain, await dummyHash);
};
