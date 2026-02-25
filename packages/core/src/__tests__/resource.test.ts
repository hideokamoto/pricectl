import { Construct } from '../construct';
import { Stack } from '../stack';
import { Resource } from '../resource';

class ConcreteResource extends Resource {
  private readonly _type: string;
  private readonly _properties: any;

  constructor(scope: Construct, id: string, type: string, properties: any) {
    super(scope, id);
    this._type = type;
    this._properties = properties;
    this.registerResourceMetadata();
  }

  protected get resourceType(): string {
    return this._type;
  }

  protected synthesizeProperties(): any {
    return this._properties;
  }
}

describe('Resource', () => {
  const API_KEY = 'sk_test_dummy_key_for_testing';

  describe('findStack', () => {
    it('直接の親がStackの場合に取得できる', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      const resource = new ConcreteResource(stack, 'Res', 'Test', {});

      expect(resource.stack).toBe(stack);
    });

    it('祖先にStackがある場合に取得できる', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      const group = new Construct(stack, 'Group');
      const resource = new ConcreteResource(group, 'Res', 'Test', {});

      expect(resource.stack).toBe(stack);
    });

    it('Stackが祖先にない場合はエラー', () => {
      const root = new Construct(undefined, 'Root');

      expect(
        () => new ConcreteResource(root, 'Res', 'Test', {})
      ).toThrow('must be created within a Stack');
    });
  });

  describe('physicalId', () => {
    it('propsで指定したphysicalIdが設定される', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });

      class ResourceWithPhysicalId extends Resource {
        constructor(scope: Construct, id: string, physicalId: string) {
          super(scope, id, { physicalId });
          this.registerResourceMetadata();
        }

        protected get resourceType(): string {
          return 'Test';
        }

        protected synthesizeProperties(): any {
          return {};
        }
      }

      const resource = new ResourceWithPhysicalId(stack, 'Res', 'prod_123');

      expect(resource.physicalId).toBe('prod_123');
    });

    it('physicalId未指定の場合はundefined', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      const resource = new ConcreteResource(stack, 'Res', 'Test', {});

      expect(resource.physicalId).toBeUndefined();
    });
  });

  describe('registerResourceMetadata', () => {
    it('resourceメタデータが登録される', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      const resource = new ConcreteResource(stack, 'Res', 'Stripe::Product', {
        name: 'Widget',
      });

      const metadata = resource.node.getMetadata('resource');

      expect(metadata).toEqual({
        type: 'Stripe::Product',
        properties: { name: 'Widget' },
      });
    });
  });
});
