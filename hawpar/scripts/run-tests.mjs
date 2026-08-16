/**
 * Test runner with an isolated data directory.
 *
 * The unit/API suites boot the real application, which persists settings,
 * tenants and documents under `config.dataDir`. Running them against the
 * default `./data` directory overwrites the workspace a developer (or a demo)
 * is actively using — the settings document in particular is replaced with
 * test fixtures. Configuration is frozen at import time, so isolation has to
 * be established in the environment *before* the test processes start.
 *
 * This runner points DATA_DIR at a throwaway directory, runs the suite, and
 * removes it afterwards, so `npm test` can never mutate real data.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `vgc-tests-${randomUUID().slice(0, 8)}-`));

const child = spawn(
  process.execPath,
  ['--test', '--test-concurrency=1', 'tests/', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, DATA_DIR: dataDir, NODE_ENV: 'test', LOG_LEVEL: process.env.LOG_LEVEL ?? 'error' }
  }
);

const code = await new Promise((resolve) => {
  child.on('close', (exitCode) => resolve(exitCode ?? 1));
  child.on('error', (error) => {
    console.error(`Failed to start the test runner: ${error.message}`);
    resolve(1);
  });
});

await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
process.exit(code);
