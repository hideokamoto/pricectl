import * as fs from 'fs';
import * as path from 'path';
import type { StackManifest } from '@pricectl/core';
import { checkFrozenLock, LOCK_FILE_NAME, nextLock, parseLock, serializeLock } from './lock';

/** Where `pricectl.lock.json` is persisted. */
export interface LockStore {
  /** Human-readable location of the lock, shown to the user. */
  readonly location: string;
  /** The saved contents, or undefined when no lock exists yet. */
  read(): string | undefined;
  write(contents: string): void;
}

/** Stores the lock as `pricectl.lock.json` in a directory. */
export class FileLockStore implements LockStore {
  readonly location: string;

  /** @param dir directory of the lock file (default: the current directory) */
  constructor(dir?: string) {
    this.location = path.resolve(dir || process.cwd(), LOCK_FILE_NAME);
  }

  read(): string | undefined {
    return fs.existsSync(this.location) ? fs.readFileSync(this.location, 'utf-8') : undefined;
  }

  /** Write the lock through a temporary file, creating its directory when needed. */
  write(contents: string): void {
    fs.mkdirSync(path.dirname(this.location), { recursive: true });
    const tmpPath = this.location + '.tmp';
    fs.writeFileSync(tmpPath, contents, 'utf-8');
    fs.renameSync(tmpPath, this.location);
  }
}

export type SyncLockResult = { ok: true; changed: boolean } | { ok: false; message: string };

/**
 * Bring the lock in line with the definition. With `frozen` (CI), the lock is only checked:
 * an out-of-date lock is refused and nothing is written.
 */
export function syncLock(manifest: StackManifest, store: LockStore, options: { frozen: boolean }): SyncLockResult {
  const current = parseLock(store.read());
  if (options.frozen) {
    const message = checkFrozenLock(manifest, current);
    return message === undefined ? { ok: true, changed: false } : { ok: false, message };
  }
  const next = serializeLock(nextLock(manifest, current));
  if (next === serializeLock(current) && store.read() !== undefined) {
    return { ok: true, changed: false };
  }
  store.write(next);
  return { ok: true, changed: true };
}
