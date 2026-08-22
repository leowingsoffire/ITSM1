/**
 * Builds the demo snapshot bundled with the Cloudflare Worker.
 *
 * The edge runtime has no durable storage and a tight CPU budget, so instead of
 * generating and analysing the sample pack on every cold start we run the real
 * pipeline once here and capture its output as a fixture. The data is genuine
 * engine output — only the moment it was produced is frozen.
 *
 * Usage: npm run build:seed
 */
process.env.PERSISTENCE = 'memory';
process.env.LOG_LEVEL = 'warn';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'seed',
  'snapshot.json'
);

async function main() {
  // Imported dynamically so the environment overrides above are applied before
  // the configuration module is evaluated.
  const { ingestDocument } = await import('../src/services/ingestion.service.js');
  const { waitForIdle } = await import('../src/services/pipeline.service.js');
  const { SAMPLE_LIBRARY, generateSamplePdf } = await import('../src/services/sample.service.js');
  const { createBatch, initialiseStore, listAllDocuments } = await import(
    '../src/services/store.service.js'
  );

  await initialiseStore();

  const batch = createBatch({
    label: 'VGC sample document pack',
    submittedBy: 'demo.user@vgc.com'
  });

  for (const sample of SAMPLE_LIBRARY) {
    const { buffer, mimeType } = await generateSamplePdf(sample.typeId, `${sample.id}:vgc-demo`);
    await ingestDocument({
      buffer,
      fileName: sample.fileName,
      mimeType,
      batchId: batch.id,
      correlationId: 'seed-builder',
      submittedBy: 'demo.user@vgc.com'
    });
  }

  await waitForIdle({ timeoutMs: 180000 });

  const documents = listAllDocuments();
  // storagePath points at a blob that will not exist in the Worker, so clear it
  // rather than leave a dangling reference behind.
  const snapshot = {
    generatedAt: new Date().toISOString(),
    batch: { ...batch, documentIds: documents.map((doc) => doc.id) },
    documents: documents.map((doc) => ({ ...doc, storagePath: null }))
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(snapshot), 'utf8');

  const pages = documents.reduce((sum, doc) => sum + (doc.pageCount ?? 0), 0);
  const bytes = (await fs.stat(OUTPUT)).size;
  console.log(
    `Snapshot written: ${documents.length} documents, ${pages} pages, ${(bytes / 1024).toFixed(0)} KB`
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
