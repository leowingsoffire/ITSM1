/**
 * Server bootstrap: store initialisation, HTTP listener and graceful shutdown.
 */
import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { flushPendingWrites, initialiseStore } from './services/store.service.js';
import { initialiseSettingsStore } from './services/settings.service.js';
import { initialiseTenantRegistry } from './services/tenant.service.js';

const SHUTDOWN_GRACE_MS = 10000;

async function main() {
  await initialiseTenantRegistry();
  await initialiseStore();
  await initialiseSettingsStore();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info('VGC OCR Intelligence is ready.', {
      url: `http://localhost:${config.port}`,
      environment: config.env,
      analyzerMode: config.analyzer.mode,
      concurrency: config.limits.pipelineConcurrency,
      maxUploadMb: config.limits.maxUploadMb
    });
  });

  server.headersTimeout = 620000;
  server.requestTimeout = 600000;

  const shutdown = (signal) => {
    logger.info('Shutdown signal received.', { signal });
    const timer = setTimeout(() => {
      logger.warn('Forcing shutdown after grace period.');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();

    server.close(async () => {
      await flushPendingWrites();
      logger.info('Shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection.', { error: reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — shutting down.', { error });
    process.exit(1);
  });
}

main().catch((error) => {
  logger.error('Fatal startup failure.', { error });
  process.exit(1);
});
