/**
 * Express application wiring.
 * Kept separate from the server bootstrap so tests can mount the app directly.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/index.js';
import {
  apiKeyAuth,
  cors,
  correlationId,
  errorHandler,
  notFoundHandler,
  rateLimit,
  requestLogger,
  securityHeaders,
  tenantContext
} from './middleware/index.js';
import documentRoutes from './routes/documents.routes.js';
import intelligenceRoutes from './routes/intelligence.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import platformRoutes from './routes/platform.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import templateRoutes from './routes/templates.routes.js';

const PUBLIC_DIR = import.meta.url
  ? path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
  : null;
const JSON_BODY_LIMIT = '256kb';
// Settings PATCH can carry a cropped logo as a base64 data URL — base64 adds
// ~33% overhead on top of the ~300KB decoded cap enforced in settings.routes.js.
const SETTINGS_JSON_BODY_LIMIT = '2mb';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(correlationId);
  app.use(securityHeaders);
  app.use(cors);
  app.use(requestLogger);
  // Body-parser skips re-parsing once `request.body` is set, so mounting a
  // larger limit for /api/settings ahead of the general parser lets that one
  // route accept a cropped logo without loosening the limit everywhere else.
  app.use('/api/settings', express.json({ limit: SETTINGS_JSON_BODY_LIMIT }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));

  // On the edge, static assets are served by the Cloudflare Assets binding
  // before a request ever reaches the Worker, and there is no file system to
  // read them from anyway.
  if (config.runtime === 'node' && PUBLIC_DIR) {
    app.use(
      express.static(PUBLIC_DIR, {
        index: 'index.html',
        // There is no build step, so assets are not content-hashed. A far-future
        // cache would serve stale JS/CSS for an hour after every deploy, so we
        // revalidate instead: ETags make the common case a cheap 304.
        etag: true,
        maxAge: 0,
        setHeaders: (response) => {
          response.setHeader('Cache-Control', 'no-cache');
        }
      })
    );
  }

  // A single /api pipeline. These middlewares used to be mounted on five
  // overlapping `/api` chains; because a non-matching router falls through to
  // the next chain, every request re-ran the rate limiter, the API-key check
  // and tenant resolution once per chain it passed. A `GET /api/documents`
  // consumed five rate-limit slots, so the configured 600 requests/minute was
  // really ~120 — and differed per route. Mounting one router guarantees each
  // request is counted, authenticated and tenant-resolved exactly once.
  const api = express.Router();
  api.use(rateLimit('api'), apiKeyAuth);
  // Onboarding is deliberately ahead of tenant resolution: it is the endpoint
  // that creates the tenant, so there is nothing to resolve yet.
  api.use(onboardingRoutes);
  api.use(tenantContext);
  api.use(platformRoutes);
  api.use(intelligenceRoutes);
  api.use(settingsRoutes);
  api.use('/documents', documentRoutes);
  api.use('/templates', templateRoutes);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
