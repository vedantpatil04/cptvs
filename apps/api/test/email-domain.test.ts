import { describe, expect, it } from 'vitest';

import { emailDomainAllowed } from '../src/modules/accounts/email-domain.js';

describe('institutional e-mail domains', () => {
  const domains = ['college.edu.in', 'staff.college.edu.in'];

  it('allows any address when no domain is configured', () => {
    expect(emailDomainAllowed('someone@gmail.com', [])).toBe(true);
  });

  it('allows the configured domains and their subdomains, case-insensitively', () => {
    expect(emailDomainAllowed('asha@college.edu.in', domains)).toBe(true);
    expect(emailDomainAllowed('Asha@COLLEGE.edu.in', domains)).toBe(true);
    expect(emailDomainAllowed('asha@cse.college.edu.in', domains)).toBe(true);
  });

  it('rejects look-alike and unrelated domains', () => {
    for (const email of [
      'asha@gmail.com',
      'asha@evilcollege.edu.in',
      'asha@college.edu.in.evil.com',
      'asha@college.edu',
      'no-at-sign',
    ]) {
      expect(emailDomainAllowed(email, domains), email).toBe(false);
    }
  });
});
