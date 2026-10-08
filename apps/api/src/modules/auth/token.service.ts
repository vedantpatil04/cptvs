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
    let payload: unknown;
    try {
      payload = jwt.verify(token, config.jwt.secret, {
        algorithms: [ALGORITHM],
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      });
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.');
      }
      throw unauthenticated('The access token is invalid.');
    }

    const claims = payload as Partial<AccessTokenClaims>;
    if (typeof claims.sub !== 'string' || !Number.isInteger(claims.tv)) {
      throw unauthenticated('The access token is invalid.');
    }
    return { userId: claims.sub, tokenVersion: claims.tv as number };
  },
};
