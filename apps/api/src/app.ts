import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { healthRouter } from './modules/health/health.routes.js';
import { apiV1Router } from './routes/api-v1.js';

export const isOriginAllowed = (origin: string, allowedOrigins: readonly string[]): boolean => {
  for (const allowed of allowedOrigins) {
    if (allowed === origin) return true;
    if (allowed.includes('*')) {
      const escaped = allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-zA-Z0-9-]+');
      const regex = new RegExp(`^${escaped}$`, 'i');
      if (regex.test(origin)) return true;
    }
  }
  return false;
};

export const createApp = (config: AppConfig): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);

  app.use(requestId);
  if (!config.isTest) app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        // Non-browser or server-to-server requests without Origin header
        if (!requestOrigin) {
          callback(null, true);
          return;
        }
        if (isOriginAllowed(requestOrigin, config.cors.origins)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Request-Id'],
      // `Date` lets the web and Android clients correct for a wrong device clock (live timers).
      exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'Date'],
      maxAge: 600,
    }),
  );
  // Identity documents arrive base64-encoded in the JSON body (at most 2 MB of file,
  // ~2.8 MB encoded). Only the registration and resubmission routes get the larger
  // limit; once a body is parsed here the default parser below skips it.
  app.use(['/api/v1/auth/register', '/api/v1/portal/verification'], express.json({ limit: '4mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter);
  app.use('/api/v1', apiV1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
