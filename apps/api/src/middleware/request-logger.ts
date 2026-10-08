import type { RequestHandler } from 'express';

import { logger } from '../lib/logger.js';

/** Logs one line per completed request. Never logs bodies or headers (credentials). */
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    const fields = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    };
    if (res.statusCode >= 500) logger.error('request failed', fields);
    else logger.info('request completed', fields);
  });
  next();
};
