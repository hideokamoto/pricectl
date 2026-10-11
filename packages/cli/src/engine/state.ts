import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ResourceState {
  logicalId: string;
  physicalId: string;
  type: string;
  path: string;
  lastDeployedAt: string;
  propertiesHash: string;
}

export interface StackState {
  resources: Record<string, ResourceState>;
}

export interface StateFile {
  version: number;
  stacks: Record<string, StackState>;
}

const STATE_VERSION = 1;
const DEFAULT_STATE_FILE = 'pricectl.state.json';

/** Where a state file is persisted. */
export interface StateStore {
  /** Human-readable location of the state, shown to the user. */
  readonly location: string;
  /** The saved contents, or undefined when nothing has been saved yet. */
  read(): string | undefined;
  write(contents: string): void;
}

/** Stores the state as `pricectl.state.json` in a directory. */
export class FileStateStore implements StateStore {
  readonly location: string;

  constructor(stateDir?: string) {
    this.location = path.resolve(stateDir || process.cwd(), DEFAULT_STATE_FILE);
  }

  read(): string | undefined {
    return fs.existsSync(this.location) ? fs.readFileSync(this.location, 'utf-8') : undefined;
  }

  write(contents: string): void {
    const dir = path.dirname(this.location);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Atomic write via temp file
    const tmpPath = this.location + '.tmp';
    fs.writeFileSync(tmpPath, contents, 'utf-8');
    fs.renameSync(tmpPath, this.location);
  }
}

export class StateManager {
  private state: StateFile;
  private readonly store: StateStore;

  /** @param storeOrDir a StateStore, or the directory of a file-based state (default: cwd) */
  constructor(storeOrDir?: StateStore | string) {
    this.store = typeof storeOrDir === 'object' ? storeOrDir : new FileStateStore(storeOrDir);
    this.state = this.load();
  }

  private load(): StateFile {
    try {
      const raw = this.store.read();
      if (raw !== undefined) {
        const parsed = JSON.parse(raw);
        if (
          parsed.version === STATE_VERSION &&
          parsed.stacks !== null &&
          typeof parsed.stacks === 'object' &&
          !Array.isArray(parsed.stacks)
        ) {
          return parsed;
        }
        // Unsupported version — start fresh
        return this.createEmpty();
      }
    } catch {
      // Corrupted or unreadable — start fresh
    }
    return this.createEmpty();
  }

  private createEmpty(): StateFile {
    return { version: STATE_VERSION, stacks: {} };
  }

  save(): void {
    this.store.write(JSON.stringify(this.state, null, 2) + '\n');
  }

  getFilePath(): string {
    return this.store.location;
  }

  getResource(stackId: string, logicalId: string): ResourceState | undefined {
    return this.state.stacks[stackId]?.resources[logicalId];
  }

  setResource(stackId: string, resource: ResourceState): void {
    if (!this.state.stacks[stackId]) {
      this.state.stacks[stackId] = { resources: {} };
    }
    this.state.stacks[stackId].resources[resource.logicalId] = resource;
  }

  removeResource(stackId: string, logicalId: string): void {
    if (this.state.stacks[stackId]) {
      delete this.state.stacks[stackId].resources[logicalId];
      // Clean up empty stack entries
      if (Object.keys(this.state.stacks[stackId].resources).length === 0) {
        delete this.state.stacks[stackId];
      }
    }
  }

  removeStack(stackId: string): void {
    delete this.state.stacks[stackId];
  }

  getStack(stackId: string): StackState | undefined {
    return this.state.stacks[stackId];
  }

  static computePropertiesHash(properties: Record<string, unknown>): string {
    const canonical = this.canonicalizeProperties(properties);
    const json = JSON.stringify(canonical);
    return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  }

  /**
   * Recursively canonicalize properties by sorting object keys at all levels.
   * This ensures consistent hashing regardless of key order in nested objects.
   */
  private static canonicalizeProperties(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalizeProperties(item));
    }

    // Object: sort keys and recursively canonicalize values
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = this.canonicalizeProperties(obj[key]);
    }
    return result;
  }
}
