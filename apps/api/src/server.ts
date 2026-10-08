import { config } from './config/index.js';
import { createApp } from './app.js';
import { disconnectDatabase } from './db/prisma.js';
import { logger } from './lib/logger.js';
import { slotHoldRepository } from './modules/parking/slot-hold.repository.js';
import { shiftService } from './modules/shifts/shift.service.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;
/** How often lapsed slot holds are returned to the pool and shifts the clock has overtaken are settled. */
const SWEEP_INTERVAL_MS = 30_000;

const app = createApp(config);

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info('CPVTS API listening', {
    host: config.server.host,
    port: config.server.port,
    environment: config.appEnv,
    version: config.version,
  });
});

/**
 * Background housekeeping, so nothing depends on someone happening to open a screen:
 * a hold that lapsed (an unconfirmed Park Now offer, a crashed request) goes back to
 * AVAILABLE, a shift nobody checked in to becomes MISSED, and a shift left open past its end
 * is checked out so its cash can be collected. Every step is idempotent.
 */
const sweeper = setInterval(() => {
  void Promise.allSettled([slotHoldRepository.releaseExpired(), shiftService.sweep()]).then(
    (results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error('background sweep failed', { err: result.reason });
        }
      }
    },
  );
}, SWEEP_INTERVAL_MS);
sweeper.unref();

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  clearInterval(sweeper);

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async (error) => {
    if (error) logger.error('error while closing HTTP server', { err: error });
    await disconnectDatabase().catch((err: unknown) =>
      logger.error('error while disconnecting database', { err }),
    );
    process.exit(error ? 1 : 0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', { err: reason });
});
