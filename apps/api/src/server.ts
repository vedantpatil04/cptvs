import { config } from './config/index.js';
import { createApp } from './app.js';
import { disconnectDatabase } from './db/prisma.js';
import { logger } from './lib/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp(config);

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info('CPVTS API listening', {
    host: config.server.host,
    port: config.server.port,
    environment: config.appEnv,
    version: config.version,
  });
});

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });

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
