/**
 * Express application wiring.
 * Kept separate from the server bootstrap so tests can mount the app directly.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/index.js';
import {
  cors,
  correlationId,
  errorHandler,
  notFoundHandler,
  rateLimit,
  requestLogger,
  securityHeaders,
  tenantContext
} from './middleware/index.js';
import { authenticate, requirePrincipal } from './middleware/auth.js';
import adminRoutes from './routes/admin.routes.js';
import authRoutes from './routes/auth.routes.js';
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

  // A single /api pipeline, so each request is rate-limited, authenticated and
  // workspace-resolved exactly once (overlapping `/api` chains used to re-run
  // the limiter per chain and silently divide the configured limit).
  //
  // 1. `authenticate` identifies the caller (session cookie, workspace API key,
  //    platform API key, or the test-only bypass). It never rejects anonymous
  //    callers itself.
  // 2. Auth and onboarding routes stay reachable without a session: they are
  //    how a session is created. Each checks its own preconditions.
  // 3. `requirePrincipal` rejects everyone else who is anonymous (except the
  //    read-only discovery endpoints the sign-in screen boots from).
  // 4. `tenantContext` resolves the workspace and the caller's role in it,
  //    refusing workspaces the caller is not a member of.
  const api = express.Router();
  api.use(rateLimit('api'));
  api.use(authenticate);
  api.use(authRoutes);
  api.use(onboardingRoutes);
  api.use(requirePrincipal);
  api.use(tenantContext);
  api.use(platformRoutes);
  api.use(intelligenceRoutes);
  api.use(settingsRoutes);
  api.use(adminRoutes);
  api.use('/documents', documentRoutes);
  api.use('/templates', templateRoutes);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
