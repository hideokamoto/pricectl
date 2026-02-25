import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateManager, StateFile, ResourceState } from '../state';

describe('StateManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-state-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates empty state when no file exists', () => {
      const manager = new StateManager(tmpDir);
      expect(manager.getStack('MyStack')).toBeUndefined();
    });

    it('loads existing state file', () => {
      const state: StateFile = {
        version: 1,
        stacks: {
          MyStack: {
            resources: {
              BasicProduct: {
                logicalId: 'BasicProduct',
                physicalId: 'prod_123',
                type: 'Stripe::Product',
                path: 'MyStack/BasicProduct',
                lastDeployedAt: '2024-01-01T00:00:00.000Z',
                propertiesHash: 'abc123',
              },
            },
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, 'pricectl.state.json'),
        JSON.stringify(state),
      );

      const manager = new StateManager(tmpDir);
      const resource = manager.getResource('MyStack', 'BasicProduct');
      expect(resource).toBeDefined();
      expect(resource!.physicalId).toBe('prod_123');
    });

    it('starts fresh when state file has wrong version', () => {
      const state = { version: 999, stacks: {} };
      fs.writeFileSync(
        path.join(tmpDir, 'pricectl.state.json'),
        JSON.stringify(state),
      );

      const manager = new StateManager(tmpDir);
      expect(manager.getStack('MyStack')).toBeUndefined();
    });

    it('starts fresh when state file is corrupted', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'pricectl.state.json'),
        'not valid json!!!',
      );

      const manager = new StateManager(tmpDir);
      expect(manager.getStack('MyStack')).toBeUndefined();
    });
  });

  describe('getResource / setResource', () => {
    it('returns undefined for non-existent resource', () => {
      const manager = new StateManager(tmpDir);
      expect(manager.getResource('MyStack', 'NonExistent')).toBeUndefined();
    });

    it('sets and retrieves a resource', () => {
      const manager = new StateManager(tmpDir);
      const resource: ResourceState = {
        logicalId: 'BasicProduct',
        physicalId: 'prod_abc',
        type: 'Stripe::Product',
        path: 'MyStack/BasicProduct',
        lastDeployedAt: '2024-01-01T00:00:00.000Z',
        propertiesHash: 'hash123',
      };

      manager.setResource('MyStack', resource);
      const retrieved = manager.getResource('MyStack', 'BasicProduct');
      expect(retrieved).toEqual(resource);
    });

    it('creates stack entry if not present', () => {
      const manager = new StateManager(tmpDir);
      expect(manager.getStack('NewStack')).toBeUndefined();

      manager.setResource('NewStack', {
        logicalId: 'Res',
        physicalId: 'prod_x',
        type: 'Stripe::Product',
        path: 'NewStack/Res',
        lastDeployedAt: '2024-01-01T00:00:00.000Z',
        propertiesHash: 'h',
      });

      expect(manager.getStack('NewStack')).toBeDefined();
    });
  });

  describe('removeResource', () => {
    it('removes a resource from state', () => {
      const manager = new StateManager(tmpDir);
      manager.setResource('MyStack', {
        logicalId: 'Prod',
        physicalId: 'prod_1',
        type: 'Stripe::Product',
        path: 'MyStack/Prod',
        lastDeployedAt: '2024-01-01T00:00:00.000Z',
        propertiesHash: 'h',
      });

      manager.removeResource('MyStack', 'Prod');
      expect(manager.getResource('MyStack', 'Prod')).toBeUndefined();
    });

    it('cleans up empty stack entry', () => {
      const manager = new StateManager(tmpDir);
      manager.setResource('MyStack', {
        logicalId: 'Prod',
        physicalId: 'prod_1',
        type: 'Stripe::Product',
        path: 'MyStack/Prod',
        lastDeployedAt: '2024-01-01T00:00:00.000Z',
        propertiesHash: 'h',
      });

      manager.removeResource('MyStack', 'Prod');
      expect(manager.getStack('MyStack')).toBeUndefined();
    });

    it('does not error when removing from non-existent stack', () => {
      const manager = new StateManager(tmpDir);
      expect(() => manager.removeResource('NoStack', 'NoRes')).not.toThrow();
    });
  });

  describe('removeStack', () => {
    it('removes an entire stack', () => {
      const manager = new StateManager(tmpDir);
      manager.setResource('MyStack', {
        logicalId: 'Prod',
        physicalId: 'prod_1',
        type: 'Stripe::Product',
        path: 'MyStack/Prod',
        lastDeployedAt: '2024-01-01T00:00:00.000Z',
        propertiesHash: 'h',
      });

      manager.removeStack('MyStack');
      expect(manager.getStack('MyStack')).toBeUndefined();
      expect(manager.getResource('MyStack', 'Prod')).toBeUndefined();
    });
  });

  describe('save', () => {
    it('persists state to disk', () => {
      const manager = new StateManager(tmpDir);
      manager.setResource('MyStack', {
        logicalId: 'Prod',
        physicalId: 'prod_1',
        type: 'Stripe::Product',
        path: 'MyStack/Prod',
        lastDeployedAt: '2024-01-01T00:00:00.000Z',
        propertiesHash: 'h',
      });
      manager.save();

      const filePath = path.join(tmpDir, 'pricectl.state.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.version).toBe(1);
      expect(content.stacks.MyStack.resources.Prod.physicalId).toBe('prod_1');
    });

    it('can be loaded by a new StateManager instance', () => {
      const manager1 = new StateManager(tmpDir);
      manager1.setResource('MyStack', {
        logicalId: 'Prod',
        physicalId: 'prod_1',
        type: 'Stripe::Product',
        path: 'MyStack/Prod',
        lastDeployedAt: '2024-01-01T00:00:00.000Z',
        propertiesHash: 'h',
      });
      manager1.save();

      const manager2 = new StateManager(tmpDir);
      const resource = manager2.getResource('MyStack', 'Prod');
      expect(resource).toBeDefined();
      expect(resource!.physicalId).toBe('prod_1');
    });
  });

  describe('computePropertiesHash', () => {
    it('returns consistent hash for same properties', () => {
      const props = { name: 'Test Product', active: true };
      const hash1 = StateManager.computePropertiesHash(props);
      const hash2 = StateManager.computePropertiesHash(props);
      expect(hash1).toBe(hash2);
    });

    it('returns same hash regardless of key order', () => {
      const props1 = { name: 'Test', active: true };
      const props2 = { active: true, name: 'Test' };
      expect(StateManager.computePropertiesHash(props1)).toBe(
        StateManager.computePropertiesHash(props2),
      );
    });

    it('returns different hash for different properties', () => {
      const props1 = { name: 'Product A' };
      const props2 = { name: 'Product B' };
      expect(StateManager.computePropertiesHash(props1)).not.toBe(
        StateManager.computePropertiesHash(props2),
      );
    });

    it('returns a 16-char hex string', () => {
      const hash = StateManager.computePropertiesHash({ foo: 'bar' });
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('getFilePath', () => {
    it('returns the resolved state file path', () => {
      const manager = new StateManager(tmpDir);
      expect(manager.getFilePath()).toBe(
        path.join(tmpDir, 'pricectl.state.json'),
      );
    });
  });
});
