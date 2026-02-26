import { Construct } from '../construct';
import { Stack } from '../stack';
import { TestResource } from './helpers';

describe('Stack', () => {
  const API_KEY = 'sk_test_dummy_key_for_testing';

  describe('コンストラクタ', () => {
    it('apiKeyをpropsから受け取れる', () => {
      const stack = new Stack(undefined, 'TestStack', { apiKey: API_KEY });

      expect(stack.apiKey).toBe(API_KEY);
    });

    it('descriptionが設定される', () => {
      const stack = new Stack(undefined, 'TestStack', {
        apiKey: API_KEY,
        description: 'A test stack',
      });

      expect(stack.description).toBe('A test stack');
    });

    it('tagsが設定される', () => {
      const stack = new Stack(undefined, 'TestStack', {
        apiKey: API_KEY,
        tags: { env: 'test' },
      });

      expect(stack.tags).toEqual({ env: 'test' });
    });

    it('tagsのデフォルトは空オブジェクト', () => {
      const stack = new Stack(undefined, 'TestStack', { apiKey: API_KEY });

      expect(stack.tags).toEqual({});
    });

    it('環境変数からapiKeyを取得できる', () => {
      const original = process.env.STRIPE_SECRET_KEY;
      try {
        process.env.STRIPE_SECRET_KEY = 'sk_test_from_env';
        const stack = new Stack(undefined, 'TestStack');

        expect(stack.apiKey).toBe('sk_test_from_env');
      } finally {
        if (original !== undefined) {
          process.env.STRIPE_SECRET_KEY = original;
        } else {
          delete process.env.STRIPE_SECRET_KEY;
        }
      }
    });

    it('apiKeyが未指定かつ環境変数もない場合はエラー', () => {
      const original = process.env.STRIPE_SECRET_KEY;
      try {
        delete process.env.STRIPE_SECRET_KEY;

        expect(() => new Stack(undefined, 'TestStack')).toThrow(
          'Stripe API key is required'
        );
      } finally {
        if (original !== undefined) {
          process.env.STRIPE_SECRET_KEY = original;
        }
      }
    });
  });

  describe('synth', () => {
    it('リソースがない場合は空のmanifestを返す', () => {
      const stack = new Stack(undefined, 'EmptyStack', { apiKey: API_KEY });

      const manifest = stack.synth();

      expect(manifest.stackId).toBe('EmptyStack');
      expect(manifest.resources).toEqual([]);
    });

    it('descriptionとtagsがmanifestに含まれる', () => {
      const stack = new Stack(undefined, 'MyStack', {
        apiKey: API_KEY,
        description: 'Test',
        tags: { env: 'staging' },
      });

      const manifest = stack.synth();

      expect(manifest.description).toBe('Test');
      expect(manifest.tags).toEqual({ env: 'staging' });
    });

    it('子リソースがmanifestに含まれる', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      new TestResource(stack, 'Product1', {
        type: 'Stripe::Product',
        properties: { name: 'Widget' },
      });

      const manifest = stack.synth();

      expect(manifest.resources).toHaveLength(1);
      expect(manifest.resources[0]).toEqual({
        id: 'Product1',
        path: 'MyStack/Product1',
        type: 'Stripe::Product',
        properties: { name: 'Widget' },
      });
    });

    it('複数リソースがmanifestに含まれる', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      new TestResource(stack, 'Prod', {
        type: 'Stripe::Product',
        properties: { name: 'Widget' },
      });
      new TestResource(stack, 'Price', {
        type: 'Stripe::Price',
        properties: { currency: 'usd', unit_amount: 1000 },
      });

      const manifest = stack.synth();

      expect(manifest.resources).toHaveLength(2);
      expect(manifest.resources.map(r => r.id)).toEqual(expect.arrayContaining(['Prod', 'Price']));
    });

    it('resourceメタデータがないConstructはmanifestに含まれない', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      // 普通のConstructにはresourceメタデータがない
      new Construct(stack, 'PlainConstruct');
      new TestResource(stack, 'Prod', {
        type: 'Stripe::Product',
        properties: { name: 'Widget' },
      });

      const manifest = stack.synth();

      expect(manifest.resources).toHaveLength(1);
      expect(manifest.resources[0].id).toBe('Prod');
    });

    it('ネストしたリソースもmanifestに含まれる', () => {
      const stack = new Stack(undefined, 'MyStack', { apiKey: API_KEY });
      const group = new Construct(stack, 'Group');
      new TestResource(group, 'NestedProduct', {
        type: 'Stripe::Product',
        properties: { name: 'Nested' },
      });

      const manifest = stack.synth();

      expect(manifest.resources).toHaveLength(1);
      expect(manifest.resources[0].path).toBe('MyStack/Group/NestedProduct');
    });
  });
});
