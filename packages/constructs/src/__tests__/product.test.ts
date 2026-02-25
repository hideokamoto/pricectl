import { Product } from '../product';
import { createStack } from './helpers';

describe('Product', () => {

  describe('プロパティの設定', () => {
    it('必須プロパティのみで生成できる', () => {
      const stack = createStack();
      const product = new Product(stack, 'MyProduct', {
        name: 'Premium Plan',
      });

      expect(product.name).toBe('Premium Plan');
      expect(product.active).toBe(true); // デフォルト値
    });

    it('activeをfalseに設定できる', () => {
      const stack = createStack();
      const product = new Product(stack, 'MyProduct', {
        name: 'Inactive Product',
        active: false,
      });

      expect(product.active).toBe(false);
    });

    it('すべてのオプショナルプロパティを設定できる', () => {
      const stack = createStack();
      const product = new Product(stack, 'FullProduct', {
        name: 'Full Product',
        active: true,
        description: 'A full product',
        images: ['https://example.com/img1.png', 'https://example.com/img2.png'],
        metadata: { tier: 'premium' },
        url: 'https://example.com/product',
        unitLabel: 'seat',
        statementDescriptor: 'ACME PREMIUM',
        taxCode: 'txcd_10000000',
      });

      expect(product.description).toBe('A full product');
      expect(product.images).toEqual([
        'https://example.com/img1.png',
        'https://example.com/img2.png',
      ]);
      expect(product.metadata).toEqual({ tier: 'premium' });
      expect(product.url).toBe('https://example.com/product');
      expect(product.unitLabel).toBe('seat');
      expect(product.statementDescriptor).toBe('ACME PREMIUM');
      expect(product.taxCode).toBe('txcd_10000000');
    });
  });

  describe('synthesizeProperties（synth経由）', () => {
    it('必須プロパティのみの場合', () => {
      const stack = createStack();
      new Product(stack, 'Prod', { name: 'Widget' });

      const manifest = stack.synth();

      expect(manifest.resources).toHaveLength(1);
      expect(manifest.resources[0].type).toBe('Stripe::Product');
      expect(manifest.resources[0].properties).toEqual({
        name: 'Widget',
        active: true,
      });
    });

    it('オプショナルプロパティがStripe API形式に変換される', () => {
      const stack = createStack();
      new Product(stack, 'Prod', {
        name: 'Widget',
        description: 'A widget',
        unitLabel: 'unit',
        statementDescriptor: 'WIDGET',
        taxCode: 'txcd_123',
        images: ['https://example.com/img.png'],
        metadata: { key: 'value' },
        url: 'https://example.com',
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.description).toBe('A widget');
      expect(props.unit_label).toBe('unit'); // camelCase → snake_case
      expect(props.statement_descriptor).toBe('WIDGET');
      expect(props.tax_code).toBe('txcd_123');
      expect(props.images).toEqual(['https://example.com/img.png']);
      expect(props.metadata).toEqual({ key: 'value' });
      expect(props.url).toBe('https://example.com');
    });

    it('未指定のオプショナルプロパティはpropertiesに含まれない', () => {
      const stack = createStack();
      new Product(stack, 'Prod', { name: 'Minimal' });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props).not.toHaveProperty('description');
      expect(props).not.toHaveProperty('images');
      expect(props).not.toHaveProperty('metadata');
      expect(props).not.toHaveProperty('url');
      expect(props).not.toHaveProperty('unit_label');
      expect(props).not.toHaveProperty('statement_descriptor');
      expect(props).not.toHaveProperty('tax_code');
    });
  });

  describe('Constructツリーとの統合', () => {
    it('Stackの子として登録される', () => {
      const stack = createStack();
      const product = new Product(stack, 'Prod', { name: 'Widget' });

      expect(stack.node.children).toContain(product);
    });

    it('pathがStack/Productの形式', () => {
      const stack = createStack();
      const product = new Product(stack, 'MyProduct', { name: 'Widget' });

      expect(product.node.path).toBe('TestStack/MyProduct');
    });
  });
});
