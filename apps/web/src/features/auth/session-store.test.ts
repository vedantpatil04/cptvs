import { afterEach, describe, expect, it } from 'vitest';

import { isExpired, sessionStore } from './session-store';

const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 1_000).toISOString();

afterEach(() => localStorage.clear());

describe('sessionStore', () => {
  it('round-trips a valid session', () => {
    const session = { accessToken: 'token', expiresAt: future() };
    sessionStore.write(session);
    expect(sessionStore.read()).toEqual(session);
  });

  it('discards expired sessions', () => {
    sessionStore.write({ accessToken: 'token', expiresAt: past() });
    expect(sessionStore.read()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('discards malformed data', () => {
    localStorage.setItem('cpvts.session', '{"accessToken":42}');
    expect(sessionStore.read()).toBeNull();
    localStorage.setItem('cpvts.session', 'not json');
    expect(sessionStore.read()).toBeNull();
  });

  it('treats unparseable expiry as expired', () => {
    expect(isExpired({ accessToken: 'token', expiresAt: 'soon' })).toBe(true);
  });
});
