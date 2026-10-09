import jwt from 'jsonwebtoken';

import { config } from '../../config/index.js';
import { AppError, unauthenticated } from '../../lib/errors.js';

interface AccessTokenClaims {
  sub: string;
  /** User token version; a mismatch means the token was revoked. */
  tv: number;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

export interface VerifiedToken {
  userId: string;
  tokenVersion: number;
}

const ALGORITHM = 'HS256';

/**
 * Visitor tokens use their own audience, so they can never be accepted as an
 * account token (and vice versa). The subject is one parking session.
 */
const visitorAudience = () => `${config.jwt.audience}:visitor`;

const verify = (token: string, audience: string): unknown => {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: [ALGORITHM],
      issuer: config.jwt.issuer,
      audience,
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    throw unauthenticated('The access token is invalid.');
  }
};

export const tokenService = {
  issueAccessToken(userId: string, tokenVersion: number): IssuedToken {
    const claims: Omit<AccessTokenClaims, 'sub'> = { tv: tokenVersion };
    const token = jwt.sign(claims, config.jwt.secret, {
      algorithm: ALGORITHM,
      subject: userId,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      expiresIn: config.jwt.expiresInSeconds,
    });
    const { exp } = jwt.decode(token) as { exp: number };
    return { token, expiresAt: new Date(exp * 1000) };
  },

  verifyAccessToken(token: string): VerifiedToken {
    const payload = verify(token, config.jwt.audience);
    const claims = payload as Partial<AccessTokenClaims>;
    if (typeof claims.sub !== 'string' || !Number.isInteger(claims.tv)) {
      throw unauthenticated('The access token is invalid.');
    }
    return { userId: claims.sub, tokenVersion: claims.tv as number };
  },

  /** Grants a visitor read access to one parking session for a limited time. */
  issueVisitorToken(sessionId: string): IssuedToken {
    const token = jwt.sign({ scope: 'visitor' }, config.jwt.secret, {
      algorithm: ALGORITHM,
      subject: sessionId,
      issuer: config.jwt.issuer,
      audience: visitorAudience(),
      expiresIn: config.accounts.visitorAccessSeconds,
    });
    const { exp } = jwt.decode(token) as { exp: number };
    return { token, expiresAt: new Date(exp * 1000) };
  },

  /**
   * Grants a visitor access to their own reservation (and, once Security activates it, lets
   * them obtain the session token). It has a different scope than a session token, so neither
   * works where the other is expected.
   */
  issueReservationToken(reservationId: string): IssuedToken {
    const token = jwt.sign({ scope: 'reservation' }, config.jwt.secret, {
      algorithm: ALGORITHM,
      subject: reservationId,
      issuer: config.jwt.issuer,
      audience: visitorAudience(),
      expiresIn: config.accounts.visitorAccessSeconds,
    });
    const { exp } = jwt.decode(token) as { exp: number };
    return { token, expiresAt: new Date(exp * 1000) };
  },

  /** Returns the reservation id a reservation token grants access to. */
  verifyReservationToken(token: string): string {
    const claims = verify(token, visitorAudience()) as { sub?: unknown; scope?: unknown };
    if (typeof claims.sub !== 'string' || claims.scope !== 'reservation') {
      throw unauthenticated('The access token is invalid.');
    }
    return claims.sub;
  },

  /** Returns the parking session id a visitor token grants access to. */
  verifyVisitorToken(token: string): string {
    const claims = verify(token, visitorAudience()) as { sub?: unknown; scope?: unknown };
    if (typeof claims.sub !== 'string' || claims.scope !== 'visitor') {
      throw unauthenticated('The access token is invalid.');
    }
    return claims.sub;
  },
};
