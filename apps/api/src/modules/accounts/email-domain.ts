import { config } from '../../config/index.js';

/**
 * Whether an e-mail address belongs to one of the allowed institutional
 * domains (or a subdomain). An empty list allows any address. `domains` is
 * injectable for tests; production uses `INSTITUTION_EMAIL_DOMAINS`.
 */
export const emailDomainAllowed = (
  email: string,
  domains: readonly string[] = config.accounts.emailDomains,
): boolean => {
  if (domains.length === 0) return true;
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
};
