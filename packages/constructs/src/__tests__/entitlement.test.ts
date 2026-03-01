import { EntitlementFeature } from '../entitlement';
import { createStack } from './helpers';

describe('EntitlementFeature', () => {

  describe('プロパティの設定', () => {
    it('必須プロパティのみで生成できる', () => {
      const stack = createStack();
      const feature = new EntitlementFeature(stack, 'PremiumSupport', {
        name: 'Premium Support',
        lookupKey: 'premium-support',
      });

      expect(feature.name).toBe('Premium Support');
      expect(feature.lookupKey).toBe('premium-support');
    });

    it('すべてのオプショナルプロパティを設定できる', () => {
      const stack = createStack();
      const feature = new EntitlementFeature(stack, 'FullFeature', {
        name: 'Full Feature',
        lookupKey: 'full-feature',
        metadata: { tier: 'enterprise' },
      });

      expect(feature.metadata).toEqual({ tier: 'enterprise' });
    });
  });

  describe('synthesizeProperties（synth経由）', () => {
    it('必須プロパティのみの場合', () => {
      const stack = createStack();
      new EntitlementFeature(stack, 'Feature1', {
        name: 'API Access',
        lookupKey: 'api-access',
      });

      const manifest = stack.synth();

      expect(manifest.resources).toHaveLength(1);
      expect(manifest.resources[0].type).toBe('Stripe::EntitlementFeature');
      expect(manifest.resources[0].properties).toEqual({
        name: 'API Access',
        lookup_key: 'api-access',
      });
    });

    it('metadataがpropertiesに含まれる', () => {
      const stack = createStack();
      new EntitlementFeature(stack, 'Feature2', {
        name: 'Dashboard Access',
        lookupKey: 'dashboard-access',
        metadata: { category: 'core' },
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.metadata).toEqual({ category: 'core' });
    });

    it('未指定のオプショナルプロパティはpropertiesに含まれない', () => {
      const stack = createStack();
      new EntitlementFeature(stack, 'Minimal', {
        name: 'Minimal',
        lookupKey: 'minimal',
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props).not.toHaveProperty('metadata');
    });
  });

  describe('resourceType', () => {
    it('Stripe::EntitlementFeatureを返す', () => {
      const stack = createStack();
      new EntitlementFeature(stack, 'MyFeature', {
        name: 'My Feature',
        lookupKey: 'my-feature',
      });

      const manifest = stack.synth();

      expect(manifest.resources[0].type).toBe('Stripe::EntitlementFeature');
    });
  });

  describe('Constructツリーとの統合', () => {
    it('Stackの子として登録される', () => {
      const stack = createStack();
      const feature = new EntitlementFeature(stack, 'Feature1', {
        name: 'Feature',
        lookupKey: 'feature',
      });

      expect(stack.node.children).toContain(feature);
    });

    it('pathがStack/EntitlementFeatureの形式', () => {
      const stack = createStack();
      const feature = new EntitlementFeature(stack, 'MyFeature', {
        name: 'Feature',
        lookupKey: 'feature',
      });

      expect(feature.node.path).toBe('TestStack/MyFeature');
    });
  });
});
