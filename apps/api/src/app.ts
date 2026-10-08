import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { healthRouter } from './modules/health/health.routes.js';
import { apiV1Router } from './routes/api-v1.js';

const UPLOAD_PATHS =
  /^\/api\/v1\/(auth\/register\/(student|staff)|portal\/verification\/resubmit)\/?$/;

export const createApp = (config: AppConfig): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);

  app.use(requestId);
  if (!config.isTest) app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      origin: [...config.cors.origins],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );
  // Registration and re-submission carry an identity document (base64, up to 2 MB).
  const json = express.json({ limit: '100kb' });
  const uploadJson = express.json({ limit: '3500kb' });
  app.use((req, res, next) =>
    UPLOAD_PATHS.test(req.path) ? uploadJson(req, res, next) : json(req, res, next),
  );

  app.use('/health', healthRouter);
  app.use('/api/v1', apiV1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
