import type { ApiErrorBody } from '@cpvts/shared';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp, isOriginAllowed } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase } from '../src/db/prisma.js';

const app = createApp(config);

afterAll(disconnectDatabase);

describe('health checks', () => {
  it('GET /health reports liveness', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /health/ready verifies the database', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });
});

describe('HTTP foundation', () => {
  it('returns a JSON 404 envelope with a request id for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    const body = res.body as ApiErrorBody;
    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username":');
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.code).toBe('BAD_REQUEST');
  });

  it('allows configured CORS origins and ignores others', async () => {
    const allowed = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not advertise the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('validates origins correctly for exact matches, wildcards, and capacitor schemes', () => {
    const allowed = ['http://localhost:5173', 'https://*.vercel.app', 'capacitor://localhost'];
    expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(true);
    expect(isOriginAllowed('https://cpvts-preview-1.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('capacitor://localhost', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://evil.com/?https://vercel.app', allowed)).toBe(false);
  });
});
