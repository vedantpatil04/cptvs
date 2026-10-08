import type { ApiErrorBody, LoginResponse } from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { createUser, resetDatabase, TEST_PASSWORD } from './helpers.js';

const app = createApp(config);

const login = (username: string, password = TEST_PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ username, password });

const tokenFor = async (username: string): Promise<string> => {
  const res = await login(username);
  expect(res.status).toBe(200);
  return (res.body as LoginResponse).accessToken;
};

beforeEach(async () => {
  await resetDatabase();
  await createUser('ADMIN', 'admin');
  await createUser('SECURITY_STAFF', 'guard');
});

afterAll(disconnectDatabase);

describe('POST /api/v1/auth/login', () => {
  it('signs in an admin and returns a bearer token with the public user', async () => {
    const res = await login('  ADMIN ');
    const body = res.body as LoginResponse;

    expect(res.status).toBe(200);
    expect(body.tokenType).toBe('Bearer');
    expect(body.accessToken).toEqual(expect.any(String));
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.user).toMatchObject({ username: 'admin', role: 'ADMIN' });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('tokenVersion');
  });

  it('signs in security staff', async () => {
    const res = await login('guard');
    expect(res.status).toBe(200);
    expect((res.body as LoginResponse).user.role).toBe('SECURITY_STAFF');
  });

  it('records a successful sign-in in the audit log and on the user', async () => {
    await login('admin');
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(user.lastLoginAt).not.toBeNull();
    const entries = await prisma.auditLog.findMany({ where: { actorId: user.id } });
    expect(entries.map((entry) => entry.action)).toEqual(['AUTH_LOGIN_SUCCEEDED']);
  });

  it.each([
    ['wrong password', 'admin', 'not-the-password'],
    ['unknown user', 'nobody', TEST_PASSWORD],
  ])('rejects a %s with the same generic error', async (_case, username, password) => {
    const res = await login(username, password);
    expect(res.status).toBe(401);
    expect((res.body as ApiErrorBody).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a disabled account', async () => {
    await createUser('SECURITY_STAFF', 'retired', { isActive: false });
    const res = await login('retired');
    expect(res.status).toBe(403);
    expect((res.body as ApiErrorBody).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('returns translatable validation errors', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: '' });
    const body = res.body as ApiErrorBody;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'body.username', message: 'validation.required' },
        { path: 'body.password', message: 'validation.required' },
      ]),
    );
  });
});

describe('authenticated routes', () => {
  it('GET /auth/me requires a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect((res.body as ApiErrorBody).error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /auth/me rejects a tampered token', async () => {
    const token = await tokenFor('admin');
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token.slice(0, -2)}xx`);
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns the current user', async () => {
    const token = await tokenFor('guard');
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user: { username: 'guard', role: 'SECURITY_STAFF' } });
  });

  it('logout revokes the token', async () => {
    const token = await tokenFor('admin');
    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  it('deactivating a user invalidates existing tokens', async () => {
    const token = await tokenFor('guard');
    await prisma.user.update({ where: { username: 'guard' }, data: { isActive: false } });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('role-based authorisation', () => {
  it('allows an admin to read system status', async () => {
    const token = await tokenFor('admin');
    const res = await request(app)
      .get('/api/v1/system/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ environment: 'test', database: { status: 'up' } });
  });

  it('forbids security staff from admin-only routes', async () => {
    const token = await tokenFor('guard');
    const res = await request(app)
      .get('/api/v1/system/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect((res.body as ApiErrorBody).error.code).toBe('FORBIDDEN');
  });
});
