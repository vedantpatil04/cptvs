import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { healthRouter } from './modules/health/health.routes.js';
import { apiV1Router } from './routes/api-v1.js';

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
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter);
  app.use('/api/v1', apiV1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
