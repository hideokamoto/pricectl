import type { StateStore } from '../../engine/state';

/** Keeps the state in memory, so unit tests do not touch the filesystem. */
export class InMemoryStateStore implements StateStore {
  readonly location = '(in memory)';
  private contents: string | undefined;

  read(): string | undefined {
    return this.contents;
  }

  write(contents: string): void {
    this.contents = contents;
  }
}
