import type { HealthResponse, ReadinessResponse } from '@cpvts/shared';
import { Router } from 'express';

import { pingDatabase } from '../../db/prisma.js';

/**
 * Unversioned, unauthenticated probes for load balancers and container
 * orchestrators. `/health` is a cheap liveness check; `/health/ready` also
 * verifies database connectivity and returns 503 when it is unavailable.
 */
export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = { status: 'ok', timestamp: new Date().toISOString() };
  res.status(200).json(body);
});

healthRouter.get('/ready', async (_req, res) => {
  const databaseUp = (await pingDatabase()) !== null;
  const body: ReadinessResponse = {
    status: databaseUp ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: { database: databaseUp ? 'up' : 'down' },
  };
  res.status(databaseUp ? 200 : 503).json(body);
});
