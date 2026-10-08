import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { VisitorAccessResponse } from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase } from '../src/db/prisma.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import { client, createParkingUser, errorCode } from './user-helpers.js';

/**
 * Every role boundary of the API, route by route. Each of the registered routes is called
 * as seven different callers; the server — not the screen in front of it — must let exactly
 * the right ones through. A guard at the end fails if a route is ever added without a line here.
 */

const app = createApp(config);

type Caller = 'anonymous' | 'visitor' | 'pending' | 'student' | 'staff' | 'security' | 'admin';
const CALLERS: Caller[] = [
  'anonymous',
  'visitor',
  'pending',
  'student',
  'staff',
  'security',
  'admin',
];

const VERIFIED: Caller[] = ['student', 'staff'];
const PARKING_USERS: Caller[] = ['pending', 'student', 'staff'];
const OPERATORS: Caller[] = ['security', 'admin'];
const ANY_ACCOUNT: Caller[] = ['pending', 'student', 'staff', 'security', 'admin'];

const ZERO = '00000000-0000-4000-8000-000000000000';
const SESSION = 'CPVTS-P-00000000';
const RECEIPT = 'CPVTS-R-2026-00000000';
const REFERENCE = 'A'.repeat(43);

interface Route {
  /** `all` is a route registered for every method; it is called with POST. */
  method: 'get' | 'post' | 'patch' | 'delete' | 'all';
  path: string;
  /** Callers that must get past authorization (they may still get a 4xx for the dummy data). */
  allowed: Caller[] | 'everyone';
  /** Status for callers that are not allowed. Default: 401 without an account token, else 403. */
  denied?: number;
  /** When allowed callers reach a handler that always refuses, the status and code it answers with. */
  reaches?: { status: number; code: string };
  /** Runs after everything else because it changes the caller's own session. */
  last?: boolean;
}

const route = (
  method: Route['method'],
  path: string,
  allowed: Route['allowed'],
  options: Partial<Pick<Route, 'denied' | 'reaches' | 'last'>> = {},
): Route => ({ method, path, allowed, ...options });

const API = '/api/v1';
const visitorOnly = { denied: 401 };

const ROUTES: Route[] = [
  // --- Health and the public overview: open to everyone ---------------------------------
  route('get', '/health', 'everyone'),
  route('get', '/health/ready', 'everyone'),
  route('get', `${API}/public/overview`, 'everyone'),
  route('get', `${API}/public/receipts/${REFERENCE}`, 'everyone'),
  route('post', `${API}/visitor/access`, 'everyone'),
  route('post', `${API}/auth/login`, 'everyone'),
  route('post', `${API}/auth/user-login`, 'everyone'),
  route('post', `${API}/auth/register/student`, 'everyone'),
  route('post', `${API}/auth/register/staff`, 'everyone'),

  // --- Any signed-in account ------------------------------------------------------------
  route('get', `${API}/auth/me`, ANY_ACCOUNT),
  route('post', `${API}/auth/logout`, ANY_ACCOUNT, { last: true }),
  route('get', `${API}/notifications`, ANY_ACCOUNT),
  route('post', `${API}/notifications/read-all`, ANY_ACCOUNT),
  route('post', `${API}/notifications/${ZERO}/read`, ANY_ACCOUNT),

  // --- Student / Campus Staff: open while verification is pending ---------------------------
  route('get', `${API}/portal/account`, PARKING_USERS),
  route('get', `${API}/portal/profile`, PARKING_USERS),
  route('patch', `${API}/portal/profile`, PARKING_USERS),
  route('post', `${API}/portal/verification/resubmit`, PARKING_USERS),
  route('get', `${API}/portal/notifications`, PARKING_USERS),
  route('post', `${API}/portal/notifications/read-all`, PARKING_USERS),
  route('post', `${API}/portal/notifications/${ZERO}/read`, PARKING_USERS),

  // --- Student / Campus Staff: verified accounts only ----------------------------------------
  route('get', `${API}/portal/overview`, VERIFIED),
  route('get', `${API}/portal/layout`, VERIFIED),
  route('get', `${API}/portal/vehicles`, VERIFIED),
  route('post', `${API}/portal/vehicles`, VERIFIED),
  route('patch', `${API}/portal/vehicles/${ZERO}`, VERIFIED),
  route('delete', `${API}/portal/vehicles/${ZERO}`, VERIFIED),
  route('post', `${API}/portal/vehicles/${ZERO}/primary`, VERIFIED),
  route('get', `${API}/portal/park-now/offer`, VERIFIED),
  route('post', `${API}/portal/park-now/offers`, VERIFIED),
  route('post', `${API}/portal/park-now/confirm`, VERIFIED),
  route('post', `${API}/portal/park-now/cancel`, VERIFIED),
  route('get', `${API}/portal/sessions/active`, VERIFIED),
  route('get', `${API}/portal/sessions/${SESSION}`, VERIFIED),
  route('get', `${API}/portal/sessions/${SESSION}/timeline`, VERIFIED),
  route('post', `${API}/portal/checkout/quote`, VERIFIED),
  route('post', `${API}/portal/sessions/${SESSION}/exit-request`, VERIFIED),
  route('delete', `${API}/portal/sessions/${SESSION}/exit-request`, VERIFIED),
  // There is no self-service payment: allowed callers get a clear refusal, not a payment.
  route('all', `${API}/portal/checkout/payments`, VERIFIED, {
    reaches: { status: 403, code: 'GATE_CHECKOUT_REQUIRED' },
  }),
  route('get', `${API}/portal/history`, VERIFIED),
  route('get', `${API}/portal/receipts`, VERIFIED),
  route('get', `${API}/portal/receipts/${RECEIPT}`, VERIFIED),

  // --- Visitor: the session token only ----------------------------------------------------------
  route('get', `${API}/visitor/session`, ['visitor'], visitorOnly),
  route('get', `${API}/visitor/layout`, ['visitor'], visitorOnly),
  route('get', `${API}/visitor/timeline`, ['visitor'], visitorOnly),
  route('post', `${API}/visitor/checkout/quote`, ['visitor'], visitorOnly),
  route('post', `${API}/visitor/exit-request`, ['visitor'], visitorOnly),
  route('delete', `${API}/visitor/exit-request`, ['visitor'], visitorOnly),
  route('all', `${API}/visitor/checkout/payments`, ['visitor'], {
    denied: 401,
    reaches: { status: 403, code: 'GATE_CHECKOUT_REQUIRED' },
  }),
  route('get', `${API}/visitor/receipt`, ['visitor'], visitorOnly),

  // --- Security Staff and administrators: the gate ---------------------------------------------------
  route('post', `${API}/parking/check-ins`, ['security']), // vehicle entry: the Security desk alone
  route('get', `${API}/parking/vehicle-lookup`, OPERATORS),
  route('get', `${API}/parking/map`, OPERATORS),
  route('get', `${API}/parking/alerts`, OPERATORS),
  route('get', `${API}/parking/sessions/active`, OPERATORS),
  route('get', `${API}/parking/sessions/${SESSION}`, OPERATORS),
  route('get', `${API}/parking/sessions/${SESSION}/timeline`, OPERATORS),
  route('get', `${API}/parking/tracking`, OPERATORS),
  route('post', `${API}/parking/checkouts/scan`, OPERATORS),
  route('post', `${API}/parking/checkouts/quote`, OPERATORS),
  route('post', `${API}/parking/payments`, OPERATORS),
  route('post', `${API}/parking/payments/${ZERO}/process`, OPERATORS),
  route('post', `${API}/parking/payments/${ZERO}/cancel`, OPERATORS),
  route('get', `${API}/parking/receipts/${RECEIPT}`, OPERATORS),
  route('get', `${API}/dashboard/summary`, OPERATORS),

  // --- Security Staff: their own shift --------------------------------------------------------------------
  route('get', `${API}/security/shift`, ['security']),
  route('post', `${API}/security/shift/check-in`, ['security']),
  route('post', `${API}/security/shift/check-out`, ['security'], { last: true }),

  // --- Administrators only -----------------------------------------------------------------------------------
  route('get', `${API}/system/status`, ['admin']),
  route('get', `${API}/admin/users`, ['admin']),
  route('get', `${API}/admin/users/counts`, ['admin']),
  route('get', `${API}/admin/users/facets`, ['admin']),
  route('get', `${API}/admin/users/${ZERO}`, ['admin']),
  route('patch', `${API}/admin/users/${ZERO}`, ['admin']),
  route('post', `${API}/admin/users/${ZERO}/status`, ['admin']),
  route('post', `${API}/admin/users/${ZERO}/verification`, ['admin']),
  route('get', `${API}/admin/users/${ZERO}/documents/${ZERO}`, ['admin']),
  route('get', `${API}/admin/users/${ZERO}/history`, ['admin']),
  route('get', `${API}/admin/users/${ZERO}/receipts`, ['admin']),
  route('get', `${API}/admin/vehicles`, ['admin']),
  route('get', `${API}/admin/vehicles/${ZERO}`, ['admin']),
  route('post', `${API}/admin/vehicles/${ZERO}/release`, ['admin']),
  route('get', `${API}/admin/visitors`, ['admin']),
  route('post', `${API}/admin/notices`, ['admin']),
  route('get', `${API}/admin/layout`, ['admin']),
  route('post', `${API}/admin/slots`, ['admin']),
  route('patch', `${API}/admin/slots/T-99`, ['admin']),
  route('delete', `${API}/admin/slots/T-99`, ['admin']),
  route('post', `${API}/admin/slots/T-99/archive`, ['admin']),
  route('post', `${API}/admin/slots/T-99/restore`, ['admin']),
  route('post', `${API}/admin/slots/T-99/enable`, ['admin']),
  route('post', `${API}/admin/slots/T-99/disable`, ['admin']),
  route('post', `${API}/admin/slots/T-99/block`, ['admin']),
  route('post', `${API}/admin/slots/T-99/unblock`, ['admin']),
  route('patch', `${API}/admin/slots/T-99/priority`, ['admin']),
  route('patch', `${API}/admin/blocks/BLOCK-NOPE/location`, ['admin']),
  route('post', `${API}/admin/blocks`, ['admin']),
  route('patch', `${API}/admin/blocks/BLOCK-NOPE`, ['admin']),
  route('post', `${API}/admin/zones`, ['admin']),
  route('patch', `${API}/admin/zones/ZONE-NOPE`, ['admin']),
  route('get', `${API}/admin/history`, ['admin']),
  route('get', `${API}/admin/reports/history`, ['admin']),
  route('get', `${API}/admin/analytics`, ['admin']),
  route('get', `${API}/admin/integrity`, ['admin']),
  route('get', `${API}/admin/audit-logs`, ['admin']),
  route('get', `${API}/admin/security-staff`, ['admin']),
  route('post', `${API}/admin/security-staff`, ['admin']),
  route('post', `${API}/admin/security-staff/${ZERO}/password`, ['admin']),
  route('get', `${API}/admin/shift-templates`, ['admin']),
  route('post', `${API}/admin/shift-templates`, ['admin']),
  route('patch', `${API}/admin/shift-templates/${ZERO}`, ['admin']),
  route('get', `${API}/admin/shifts/roster`, ['admin']),
  route('get', `${API}/admin/shifts`, ['admin']),
  route('post', `${API}/admin/shifts`, ['admin']),
  route('get', `${API}/admin/shifts/${ZERO}`, ['admin']),
  route('patch', `${API}/admin/shifts/${ZERO}`, ['admin']),
  route('delete', `${API}/admin/shifts/${ZERO}`, ['admin']),
  route('post', `${API}/admin/shifts/${ZERO}/check-out`, ['admin']),
  route('get', `${API}/admin/shifts/${ZERO}/transactions`, ['admin']),
  route('post', `${API}/admin/shifts/${ZERO}/handover`, ['admin']),
  route('post', `${API}/admin/shifts/${ZERO}/handover/resolve`, ['admin']),
  route('get', `${API}/admin/cash/summary`, ['admin']),
  route('get', `${API}/admin/cash/discrepancies`, ['admin']),
];

let round = 0;

/** Fresh sessions for every caller (a logout or check-out changes the caller's own session). */
const tokens = async (): Promise<Record<Caller, string | undefined>> => {
  round += 1;
  const guard = await signIn('SECURITY_STAFF', `guard-${round}`);
  const boss = await signIn('ADMIN', `boss-${round}`);
  const make = async (
    category: 'STUDENT' | 'STAFF',
    verification: 'VERIFIED' | 'PENDING',
    id: string,
  ) => (await createParkingUser({ category, verification, institutionalId: id })).token;
  const plate = `MH12CD${1000 + round}`;
  const entry = await parkingApi(app, guard.token).checkInOk(plate, 'FOUR_WHEELER', 'VISITOR', 9);
  const access = await client(app).post('/visitor/access', {
    vehicleNumber: plate,
    sessionNumber: entry.session.sessionNumber,
  });
  return {
    anonymous: undefined,
    visitor: (access.body as VisitorAccessResponse).accessToken,
    pending: await make('STUDENT', 'PENDING', `2BT22PD${round}`),
    student: await make('STUDENT', 'VERIFIED', `2BT22ST${round}`),
    staff: await make('STAFF', 'VERIFIED', `EMP-${round}`),
    security: guard.token,
    admin: boss.token,
  };
};

const call = async (target: Route, token: string | undefined) => {
  const send = request(app)[target.method === 'all' ? 'post' : target.method](target.path);
  if (token) send.set('Authorization', `Bearer ${token}`);
  return target.method === 'get' || target.method === 'delete' ? send : send.send({});
};

let live: Record<Caller, string | undefined>;

beforeAll(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  live = await tokens();
});

afterAll(disconnectDatabase);

describe('every route, as every caller', () => {
  const run = async (target: Route, sessions: Record<Caller, string | undefined>) => {
    for (const caller of CALLERS) {
      const token = sessions[caller];
      const res = await call(target, token);
      const label = `${caller} → ${target.method.toUpperCase()} ${target.path}`;
      expect(res.status, `${label} (server error)`).toBeLessThan(500);

      const allowed = target.allowed === 'everyone' || target.allowed.includes(caller);
      if (allowed) {
        if (target.reaches) {
          expect(res.status, label).toBe(target.reaches.status);
          expect(errorCode(res), label).toBe(target.reaches.code);
        } else {
          expect([401, 403], label).not.toContain(res.status);
        }
      } else {
        const expected =
          target.denied ?? (caller === 'anonymous' || caller === 'visitor' ? 401 : 403);
        expect(res.status, label).toBe(expected);
      }
    }
  };

  const ordinary = ROUTES.filter((r) => !r.last);
  it.each(ordinary.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
    '%s',
    async (_name, target) => {
      await run(target, live);
    },
    60_000,
  );

  // These change the caller’s own session, so they run last, each time with fresh sessions.
  const lastOnes = ROUTES.filter((r) => r.last);
  it.each(lastOnes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
    '%s',
    async (_name, target) => {
      await run(target, await tokens());
    },
    60_000,
  );
});

describe('the matrix covers the whole API', () => {
  it('has a line for every registered route', () => {
    const modules = fileURLToPath(new URL('../src/modules', import.meta.url));
    const files = (readdirSync(modules, { recursive: true }) as string[]).filter((f) =>
      f.endsWith('.ts'),
    );
    let registered = 0;
    for (const file of files) {
      const source = readFileSync(`${modules}/${file}`, 'utf8');
      registered +=
        source.match(/\b[a-zA-Z]+Router\.(?:get|post|put|patch|delete|all)\(/g)?.length ?? 0;
    }
    // If this fails, a route was added (or removed): decide who may call it and list it above.
    expect(ROUTES).toHaveLength(registered);
  });

  it('never lets a visitor token act as an account, or an account token as a visitor', async () => {
    const visitor = live.visitor!;
    for (const path of ['/auth/me', '/portal/account', '/notifications', '/security/shift']) {
      expect((await client(app, visitor).get(path)).status, path).toBe(401);
    }
    const account = tokenService.issueAccessToken('00000000-0000-4000-8000-000000000001', 0).token;
    expect((await client(app, account).get('/visitor/session')).status).toBe(401);
  });
});
