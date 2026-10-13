import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileLockStore } from '../../engine/lock-store';

describe('FileLockStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-lock-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads nothing when pricectl.lock.json does not exist', () => {
    expect(new FileLockStore(dir).read()).toBeUndefined();
  });

  it('writes pricectl.lock.json in the directory and reads it back', () => {
    const store = new FileLockStore(dir);

    store.write('{"version":1,"stacks":{}}\n');

    expect(fs.readFileSync(path.join(dir, 'pricectl.lock.json'), 'utf-8')).toBe('{"version":1,"stacks":{}}\n');
    expect(store.read()).toBe('{"version":1,"stacks":{}}\n');
  });

  it('creates the directory when it does not exist', () => {
    const store = new FileLockStore(path.join(dir, 'nested'));

    store.write('x');

    expect(store.read()).toBe('x');
  });
});
