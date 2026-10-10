/**
 * Atomic-write regression tests.
 *
 * Goal: a crash mid-write must never leave a truncated JSON store behind.
 * Verifies `atomicWriteFile()` creates parent dirs, replaces content, and
 * leaves no `.tmp-*` artefacts (the temp file is renamed, not copied).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import './helpers/isolation.js';
import { atomicWriteFile } from '../src/lib/atomicWrite.js';

describe('atomic file writes', () => {
  test('should_create_parent_dirs_and_leave_no_temp_artefacts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hawpar-atomic-'));
    const target = path.join(dir, 'nested', 'store.json');
    await atomicWriteFile(target, JSON.stringify({ a: 1 }), 'utf8');
    assert.equal(await fs.readFile(target, 'utf8'), JSON.stringify({ a: 1 }));
    const leftovers = (await fs.readdir(path.join(dir, 'nested'))).filter((name) =>
      name.startsWith('.tmp-')
    );
    assert.deepEqual(leftovers, []);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('should_replace_existing_content_atomically', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hawpar-atomic-'));
    const target = path.join(dir, 'doc.json');
    await atomicWriteFile(target, 'v1', 'utf8');
    await atomicWriteFile(target, 'v2', 'utf8');
    assert.equal(await fs.readFile(target, 'utf8'), 'v2');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
