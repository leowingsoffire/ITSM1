/**
 * Cloudflare Workers entry point.
 *
 * Runs the same Express application as the Node deployment on top of the
 * Workers `node:http` compatibility layer. Static assets are served by the
 * Workers Assets binding ahead of the Worker, so only `/api/*` reaches Express.
 */
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from '../src/app.js';
import { logger } from '../src/lib/logger.js';
import snapshot from '../src/seed/snapshot.json';
import { hydrateRunHistory } from '../src/services/pipeline.service.js';
import { hydrateStore } from '../src/services/store.service.js';

const PORT = 8787;

// Module scope runs once per isolate, so the demo corpus is loaded on cold
// start rather than on every request. Nothing here performs I/O: the edge build
// keeps documents in the isolate, so hydration is a synchronous map fill.
hydrateStore(snapshot);
// The orchestration history is a rolling in-process window. Snapshot documents
// were never processed by this isolate, so replay the runs they carry.
const restoredRuns = hydrateRunHistory(snapshot.documents);

logger.info('VGC OCR Intelligence ready on Cloudflare Workers.', {
  snapshotGeneratedAt: snapshot.generatedAt,
  documentCount: snapshot.documents.length,
  restoredRuns
});

const server = createServer(createApp());
server.listen(PORT);

export default httpServerHandler({ port: PORT });
