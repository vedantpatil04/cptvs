import type {
  AcademicProgram,
  ApiErrorBody,
  ParkingUserCategory,
  VerificationStatus,
} from '@cpvts/shared';
import type { Express } from 'express';
import request from 'supertest';

import { prisma } from '../src/db/prisma.js';
import { campusHour } from '../src/lib/campus-time.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import { TEST_PASSWORD } from './helpers.js';
import { signIn } from './parking-helpers.js';

export const API = '/api/v1';

/** The smallest bytes the server accepts as a PNG: only the file signature is checked. */
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

export const identityDocument = (bytes: Buffer = PNG_BYTES, mimeType = 'image/png') => ({
  fileName: 'college-id.png',
  mimeType,
  contentBase64: bytes.toString('base64'),
});

/** What a student gives at registration to identify themselves academically. */
export interface AcademicDetails {
  program: AcademicProgram;
  department: string;
  admissionYear: number;
  currentSemester: number;
}

export const academicDetails = (overrides: Partial<AcademicDetails> = {}): AcademicDetails => ({
  program: 'BCA',
  department: 'Computer Applications',
  admissionYear: 2024,
  currentSemester: 3,
  ...overrides,
});

/** A student registration; Campus Staff registration ignores the `academic` block. */
export const registrationBody = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Asha Patil',
  institutionalId: '2bt22cs001',
  confirmInstitutionalId: '2BT22CS001',
  email: 'Asha@College.edu.in',
  phone: '+91 98450 12345',
  password: TEST_PASSWORD,
  document: identityDocument(),
  academic: academicDetails(),
  ...overrides,
});

export const errorCode = (res: { body: unknown }) => (res.body as ApiErrorBody).error.code;

/** A small authenticated client for `/api/v1`. Pass a path relative to it, e.g. `/portal/vehicles`. */
export const client = (app: Express, token?: string) => {
  const auth = (req: request.Test) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  return {
    get: (path: string, query: Record<string, string | number | boolean> = {}) =>
      auth(request(app).get(`${API}${path}`).query(query)),
    post: (path: string, body: object = {}) => auth(request(app).post(`${API}${path}`).send(body)),
    patch: (path: string, body: object = {}) =>
      auth(request(app).patch(`${API}${path}`).send(body)),
    delete: (path: string) => auth(request(app).delete(`${API}${path}`)),
  };
};

let passwordHash: string | undefined;

export interface ParkingUserOptions {
  category?: ParkingUserCategory;
  verification?: VerificationStatus;
  institutionalId?: string;
  email?: string;
  fullName?: string;
  isActive?: boolean;
  note?: string;
  /** Students only. `null` leaves the academic profile empty (an account from before it existed). */
  academic?: Partial<AcademicDetails> | null;
}

/** Creates a Student / Campus Staff account directly (fast path for tests that are not about registration). */
export const createParkingUser = async (options: ParkingUserOptions = {}) => {
  const category = options.category ?? 'STUDENT';
  const institutionalId = (
    options.institutionalId ?? (category === 'STUDENT' ? '2BT22CS001' : 'EMP-1042')
  ).toUpperCase();
  const verification = options.verification ?? 'VERIFIED';
  passwordHash ??= await hashPassword(TEST_PASSWORD);

  const user = await prisma.user.create({
    data: {
      username: `${category.toLowerCase()}:${institutionalId.toLowerCase()}`,
      fullName: options.fullName ?? `${category} ${institutionalId}`,
      passwordHash,
      role: 'PARKING_USER',
      isActive: options.isActive ?? true,
      parkingProfile: {
        create: {
          category,
          institutionalId,
          email: (options.email ?? `${institutionalId.toLowerCase()}@college.edu.in`).toLowerCase(),
          phone: '+919845012345',
          verificationStatus: verification,
          verificationNote:
            verification === 'REJECTED' ? (options.note ?? 'Photo unreadable') : null,
          verificationSubmittedAt: new Date(),
          ...(verification === 'PENDING' ? {} : { reviewedAt: new Date() }),
          // Students carry academic details unless the test asks for an older, empty account.
          ...(category === 'STUDENT' && options.academic !== null
            ? academicDetails(options.academic ?? {})
            : {}),
        },
      },
    },
  });
  await prisma.identityDocument.create({
    data: {
      userId: user.id,
      institutionalId,
      fileName: 'college-id.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: 'a'.repeat(64),
      content: new Uint8Array(PNG_BYTES),
    },
  });
  const token = tokenService.issueAccessToken(user.id, user.tokenVersion).token;
  return { user, token };
};

/** A verified user with one registered vehicle, ready to Park Now. */
export const createParkingUserWithVehicle = async (
  app: Express,
  options: ParkingUserOptions & {
    vehicleNumber?: string;
    vehicleType?: 'TWO_WHEELER' | 'FOUR_WHEELER';
  } = {},
) => {
  const account = await createParkingUser(options);
  const res = await client(app, account.token).post('/portal/vehicles', {
    vehicleNumber: options.vehicleNumber ?? 'KA22AB1234',
    vehicleType: options.vehicleType ?? 'TWO_WHEELER',
  });
  if (res.status !== 201)
    throw new Error(`vehicle registration failed: ${JSON.stringify(res.body)}`);
  return { ...account, vehicle: res.body as { id: string; vehicleNumber: string } };
};

export const adminAccount = (username = 'boss') => signIn('ADMIN', username);
export const guardAccount = (username = 'guard') => signIn('SECURITY_STAFF', username);

/** The first future instant whose campus hour is `hour` (used to fake the clock for checkout). */
export const nextInstantAtCampusHour = (hour: number, from = new Date()): Date => {
  for (let k = 1; k <= 24; k += 1) {
    const candidate = new Date(from.getTime() + k * 3_600_000);
    if (campusHour(candidate) === hour) return candidate;
  }
  throw new Error(`no instant with campus hour ${hour}`);
};
