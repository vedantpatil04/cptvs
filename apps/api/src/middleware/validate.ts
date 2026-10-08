import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

import { validationError } from '../lib/errors.js';

export interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and normalises the request against zod schemas. On success the
 * parsed values replace the raw ones, so handlers only ever see validated data.
 * Issue messages are translation keys shared with the web client.
 */
export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    const issues: { path: string; message: string }[] = [];

    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location] ?? {});
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ path: [location, ...issue.path].join('.'), message: issue.message });
        }
        continue;
      }

      // Express 5 exposes `req.query` as a getter, so redefine instead of assigning.
      Object.defineProperty(req, location, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    if (issues.length) {
      next(validationError(issues));
      return;
    }
    next();
  };
