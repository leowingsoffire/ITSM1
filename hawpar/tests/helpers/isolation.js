/**
 * Data-directory isolation guard.
 *
 * The API/store suites boot the real application and clear the document and
 * settings stores as part of their setup. Run against the default `./data`
 * directory that is a destructive operation: it deletes persisted documents
 * and overwrites `settings.json` with test fixtures.
 *
 * `npm test` provisions a throwaway DATA_DIR (see scripts/run-tests.mjs), but
 * running a single file directly — `node --test tests/api.test.js` — bypasses
 * that. Importing this module makes such a run fail immediately, with an
 * explanation, instead of quietly destroying a working workspace.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolved the same way as src/config/index.js, but without importing it.
 * Importing config here would freeze it before a test file has had a chance to
 * set environment overrides of its own (config snapshots process.env once).
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configuredDataDir = path.resolve(projectRoot, process.env.DATA_DIR?.trim() || './data');

/** Resolves symlinks (macOS /tmp) so the prefix comparison is meaningful. */
function canonical(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

const dataDir = canonical(configuredDataDir);
const tempRoot = canonical(os.tmpdir());
const isolated = dataDir === tempRoot || dataDir.startsWith(tempRoot + path.sep);

if (!isolated) {
  throw new Error(
    [
      `Refusing to run tests against "${dataDir}".`,
      'This suite clears the document store and rewrites settings.json, which would destroy real data.',
      'Run "npm test" (it provisions an isolated DATA_DIR), or set DATA_DIR to a throwaway directory first.'
    ].join('\n')
  );
}

export { dataDir as isolatedDataDir };
