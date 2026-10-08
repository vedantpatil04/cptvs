import type {
  ApiErrorBody,
  ParkingUserCategory,
  RegisteredVehicle,
  VerificationStatus,
} from '@cpvts/shared';
import type { Express } from 'express';
import request from 'supertest';
import { expect, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import { TEST_PASSWORD } from './helpers.js';

export const app: Express = createApp(config);
export const API = '/api/v1';

/** The first bytes of a real PNG: enough for the server's content sniffing. */
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

export const document = (bytes: Buffer = PNG_BYTES, mimeType = 'image/png') => ({
  fileName: 'college-id.png',
  mimeType,
  contentBase64: bytes.toString('base64'),
});

export const registration = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  fullName: 'Asha Patil',
  institutionalId: id,
  confirmInstitutionalId: id,
  email,
  phone: '9876543210',
  password: TEST_PASSWORD,
  document: document(),
  ...extra,
});

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const errorCode = (body: unknown) => (body as ApiErrorBody).error.code;

let passwordHash: string | undefined;
let counter = 0;

/** Creates a parking user directly in the database (faster than the registration endpoint). */
export const createParkingUser = async (
  category: ParkingUserCategory,
  status: VerificationStatus = 'VERIFIED',
  overrides: { email?: string; institutionalId?: string; isActive?: boolean } = {},
) => {
  passwordHash ??= await hashPassword(TEST_PASSWORD);
  counter += 1;
  const institutionalId = overrides.institutionalId ?? `${category[0]}ID${counter}00`;
  const email = overrides.email ?? `${category.toLowerCase()}${counter}@college.edu.in`;
  const user = await prisma.user.create({
    data: {
      username: `${category.toLowerCase()}:${institutionalId.toLowerCase()}`,
      fullName: `${category} ${counter}`,
      passwordHash,
      role: 'PARKING_USER',
      isActive: overrides.isActive ?? true,
      parkingProfile: {
        create: {
          category,
          institutionalId,
          email,
          phone: '9876543210',
          verificationStatus: status,
          verificationSubmittedAt: new Date(),
        },
      },
      identityDocuments: {
        create: {
          institutionalId,
          fileName: 'college-id.png',
          mimeType: 'image/png',
          sizeBytes: PNG_BYTES.length,
          sha256: 'a'.repeat(64),
          content: new Uint8Array(PNG_BYTES),
        },
      },
    },
    include: { identityDocuments: true },
  });
  return {
    user,
    email,
    institutionalId,
    documentId: user.identityDocuments[0]!.id,
    token: tokenService.issueAccessToken(user.id, user.tokenVersion).token,
  };
};

export const portal = (token: string) => ({
  get: (path: string) => request(app).get(`${API}/portal${path}`).set(bearer(token)),
  post: (path: string, body: object = {}) =>
    request(app).post(`${API}/portal${path}`).set(bearer(token)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(`${API}/portal${path}`).set(bearer(token)).send(body),
});

export const admin = (token: string) => ({
  get: (path: string) => request(app).get(`${API}/admin${path}`).set(bearer(token)),
  post: (path: string, body: object = {}) =>
    request(app).post(`${API}/admin${path}`).set(bearer(token)).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(`${API}/admin${path}`).set(bearer(token)).send(body),
  delete: (path: string) => request(app).delete(`${API}/admin${path}`).set(bearer(token)),
});

export const visitor = (token: string) => ({
  get: (path: string) => request(app).get(`${API}/visitor${path}`).set(bearer(token)),
  post: (path: string, body: object = {}) =>
    request(app).post(`${API}/visitor${path}`).set(bearer(token)).send(body),
});

export const addVehicle = async (
  token: string,
  vehicleNumber: string,
  vehicleType = 'TWO_WHEELER',
) => {
  const res = await portal(token).post('/vehicles', { vehicleNumber, vehicleType });
  expect(res.status).toBe(201);
  return res.body as RegisteredVehicle;
};

/**
 * Freezes the clock at a campus hour (Asia/Kolkata, UTC+05:30) on a fixed day.
 * Only `Date` is faked, so timers, the database driver and bcrypt run normally.
 * Call `vi.useRealTimers()` afterwards.
 */
export const setCampusHour = (hour: number, minute = 10): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 8, 0, hour * 60 + minute - 330)));
};
