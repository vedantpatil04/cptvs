import type { SystemStatusResponse } from '@cpvts/shared';

import { config } from '../../config/index.js';
import { pingDatabase } from '../../db/prisma.js';

export const systemService = {
  async getStatus(): Promise<SystemStatusResponse> {
    const latencyMs = await pingDatabase();
    return {
      environment: config.appEnv,
      version: config.version,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      database: { status: latencyMs === null ? 'down' : 'up', latencyMs },
    };
  },
};
