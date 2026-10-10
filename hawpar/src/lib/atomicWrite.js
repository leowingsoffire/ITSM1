/**
 * Atomic file writes.
 *
 * Direct `fs.writeFile()` leaves a truncated JSON file when the process
 * crashes, loses power, or the disk fills mid-write — the next boot then
 * logs "Skipping unreadable document file" and silently drops data. Writing
 * to a temp file in the same directory and renaming over the target makes
 * each persist all-or-nothing: readers only ever see the old or the new
 * version, never a half-written file.
 *
 * Same-directory temp + rename stays on one filesystem so the rename is
 * atomic on POSIX and Windows. No new dependencies.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} targetPath final destination file path
 * @param {string|Buffer|Uint8Array} content bytes to persist
 * @param {string|object} [encodingOrOptions] forwarded to `fs.writeFile` for the temp file
 */
export async function atomicWriteFile(targetPath, content, encodingOrOptions) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${randomUUID()}`);
  try {
    await fs.writeFile(tmpPath, content, encodingOrOptions);
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}
