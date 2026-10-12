import type { LockStore } from '../../engine/lock-store';

/** Keeps the lock in memory, so unit tests do not touch the filesystem. */
export class InMemoryLockStore implements LockStore {
  readonly location = '(in memory)';
  writes = 0;
  private contents: string | undefined;

  read(): string | undefined {
    return this.contents;
  }

  write(contents: string): void {
    this.writes += 1;
    this.contents = contents;
  }
}
