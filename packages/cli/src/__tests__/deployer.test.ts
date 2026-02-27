import { StackManifest } from '@pricectl/core';
import { StripeDeployer } from '../engine/deployer';

// Stripe SDKのモック
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripeInstance);
});

// モック用のStripeインスタンス
const mockStripeInstance = {
  products: {
    create: jest.fn(),
    update: jest.fn(),
    del: jest.fn(),
    search: jest.fn(),
  },
  prices: {
    create: jest.fn(),
    update: jest.fn(),
    search: jest.fn(),
  },
  coupons: {
    create: jest.fn(),
    retrieve: jest.fn(),
    del: jest.fn(),
  },
};

function resetMocks() {
  Object.values(mockStripeInstance).forEach(resource => {
    Object.values(resource).forEach(fn => {
      (fn as jest.Mock).mockReset();
    });
  });
}

describe('StripeDeployer', () => {
  let deployer: StripeDeployer;

  beforeEach(() => {
    resetMocks();
    deployer = new StripeDeployer('sk_test_dummy');
  });

  describe('deploy', () => {
    describe('Product', () => {
      it('新規Productを作成する', async () => {
        mockStripeInstance.products.search.mockResolvedValue({ data: [] });
        mockStripeInstance.products.create.mockResolvedValue({
          id: 'prod_new_123',
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'MyProduct',
              path: 'TestStack/MyProduct',
              type: 'Stripe::Product',
              properties: { name: 'Widget', active: true },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed).toHaveLength(1);
        expect(result.deployed[0]).toEqual({
          id: 'MyProduct',
          type: 'Stripe::Product',
          physicalId: 'prod_new_123',
          status: 'created',
        });
        expect(result.errors).toHaveLength(0);

        // pricectl_idメタデータが付与されることを確認
        expect(mockStripeInstance.products.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Widget',
            active: true,
            metadata: expect.objectContaining({
              pricectl_id: 'MyProduct',
              pricectl_path: 'TestStack/MyProduct',
            }),
          })
        );
      });

      it('既存Productを更新する', async () => {
        mockStripeInstance.products.search.mockResolvedValue({
          data: [{ id: 'prod_existing_456' }],
        });
        mockStripeInstance.products.update.mockResolvedValue({
          id: 'prod_existing_456',
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'MyProduct',
              path: 'TestStack/MyProduct',
              type: 'Stripe::Product',
              properties: { name: 'Updated Widget', active: true },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed).toHaveLength(1);
        expect(result.deployed[0].status).toBe('updated');
        expect(result.deployed[0].physicalId).toBe('prod_existing_456');

        expect(mockStripeInstance.products.update).toHaveBeenCalledWith(
          'prod_existing_456',
          expect.objectContaining({
            name: 'Updated Widget',
            active: true,
            metadata: expect.objectContaining({
              pricectl_id: 'MyProduct',
              pricectl_path: 'TestStack/MyProduct',
            }),
          })
        );
      });
    });

    describe('Price', () => {
      it('新規Priceを作成する', async () => {
        mockStripeInstance.prices.search.mockResolvedValue({ data: [] });
        mockStripeInstance.prices.create.mockResolvedValue({
          id: 'price_new_789',
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'MonthlyPrice',
              path: 'TestStack/MonthlyPrice',
              type: 'Stripe::Price',
              properties: {
                product: 'prod_123',
                currency: 'usd',
                unit_amount: 999,
                active: true,
              },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed).toHaveLength(1);
        expect(result.deployed[0]).toEqual({
          id: 'MonthlyPrice',
          type: 'Stripe::Price',
          physicalId: 'price_new_789',
          status: 'created',
        });
      });

      it('変更なしのPriceはunchangedになる', async () => {
        const existingPrice = {
          id: 'price_existing',
          product: 'prod_123',
          currency: 'usd',
          unit_amount: 999,
          unit_amount_decimal: undefined,
          active: true,
          nickname: undefined,
          recurring: null,
          tiers_mode: undefined,
          tiers: null,
          transform_quantity: null,
          lookup_key: undefined,
        };

        mockStripeInstance.prices.search.mockResolvedValue({
          data: [existingPrice],
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'MyPrice',
              path: 'TestStack/MyPrice',
              type: 'Stripe::Price',
              properties: {
                product: 'prod_123',
                currency: 'usd',
                unit_amount: 999,
                active: true,
              },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed).toHaveLength(1);
        expect(result.deployed[0].status).toBe('unchanged');
        expect(result.deployed[0].physicalId).toBe('price_existing');
      });

      it('変更ありのPriceは旧Priceを無効化して新規作成する', async () => {
        const existingPrice = {
          id: 'price_old',
          product: 'prod_123',
          currency: 'usd',
          unit_amount: 500,
          unit_amount_decimal: undefined,
          active: true,
          nickname: undefined,
          recurring: null,
          tiers_mode: undefined,
          tiers: null,
          transform_quantity: null,
          lookup_key: undefined,
        };

        mockStripeInstance.prices.search.mockResolvedValue({
          data: [existingPrice],
        });
        mockStripeInstance.prices.update.mockResolvedValue({});
        mockStripeInstance.prices.create.mockResolvedValue({
          id: 'price_new',
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'MyPrice',
              path: 'TestStack/MyPrice',
              type: 'Stripe::Price',
              properties: {
                product: 'prod_123',
                currency: 'usd',
                unit_amount: 999, // 変更
                active: true,
              },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed[0].status).toBe('created');
        expect(result.deployed[0].physicalId).toBe('price_new');

        // 旧Priceが無効化されたことを確認
        expect(mockStripeInstance.prices.update).toHaveBeenCalledWith(
          'price_old',
          { active: false }
        );
      });
    });

    describe('Coupon', () => {
      it('新規Couponを作成する（resource_missingエラー時）', async () => {
        const notFoundError = new Error('No such coupon');
        Object.assign(notFoundError, { code: 'resource_missing' });
        mockStripeInstance.coupons.retrieve.mockRejectedValue(notFoundError);
        mockStripeInstance.coupons.create.mockResolvedValue({
          id: 'SUMMER20',
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'SUMMER20',
              path: 'TestStack/SUMMER20',
              type: 'Stripe::Coupon',
              properties: {
                duration: 'once',
                percent_off: 20,
              },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed).toHaveLength(1);
        expect(result.deployed[0]).toEqual({
          id: 'SUMMER20',
          type: 'Stripe::Coupon',
          physicalId: 'SUMMER20',
          status: 'created',
        });
      });

      it('既存Couponが見つかった場合はunchanged', async () => {
        mockStripeInstance.coupons.retrieve.mockResolvedValue({
          id: 'EXISTING',
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'EXISTING',
              path: 'TestStack/EXISTING',
              type: 'Stripe::Coupon',
              properties: { duration: 'once', percent_off: 10 },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed[0].status).toBe('unchanged');
      });
    });

    describe('依存関係の解決', () => {
      it('Productの物理IDがPriceのproductプロパティに反映される', async () => {
        // Product: 新規作成
        mockStripeInstance.products.search.mockResolvedValue({ data: [] });
        mockStripeInstance.products.create.mockResolvedValue({
          id: 'prod_resolved_abc',
        });

        // Price: 新規作成
        mockStripeInstance.prices.search.mockResolvedValue({ data: [] });
        mockStripeInstance.prices.create.mockResolvedValue({
          id: 'price_created_xyz',
        });

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'MyProduct',
              path: 'TestStack/MyProduct',
              type: 'Stripe::Product',
              properties: { name: 'Widget', active: true },
            },
            {
              id: 'MyPrice',
              path: 'TestStack/MyPrice',
              type: 'Stripe::Price',
              properties: {
                product: 'MyProduct', // 論理ID
                currency: 'usd',
                unit_amount: 1000,
                active: true,
              },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed).toHaveLength(2);

        // PriceのcreateでproductがphysicalId（prod_resolved_abc）に解決されている
        expect(mockStripeInstance.prices.create).toHaveBeenCalledWith(
          expect.objectContaining({
            product: 'prod_resolved_abc',
          })
        );
      });
    });

    describe('エラーハンドリング', () => {
      it('デプロイ中のエラーがerrors配列に記録される', async () => {
        mockStripeInstance.products.search.mockRejectedValue(
          new Error('Network failure')
        );

        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'BadProduct',
              path: 'TestStack/BadProduct',
              type: 'Stripe::Product',
              properties: { name: 'Widget' },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed).toHaveLength(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toEqual({
          id: 'BadProduct',
          type: 'Stripe::Product',
          error: 'Network failure',
        });
      });

      it('未知のリソースタイプはエラーになる', async () => {
        const manifest: StackManifest = {
          stackId: 'TestStack',
          tags: {},
          resources: [
            {
              id: 'Unknown',
              path: 'TestStack/Unknown',
              type: 'Stripe::Unknown',
              properties: {},
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].error).toContain('Unknown resource type');
      });
    });
  });

  describe('destroy', () => {
    it('Productを削除する', async () => {
      mockStripeInstance.products.search.mockResolvedValue({
        data: [{ id: 'prod_to_delete' }],
      });
      mockStripeInstance.products.del.mockResolvedValue({});

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'MyProduct',
            path: 'TestStack/MyProduct',
            type: 'Stripe::Product',
            properties: { name: 'Widget' },
          },
        ],
      };

      const result = await deployer.destroy(manifest);

      expect(result.destroyed).toHaveLength(1);
      expect(result.destroyed[0]).toEqual({
        id: 'MyProduct',
        type: 'Stripe::Product',
        status: 'deleted',
      });
      expect(mockStripeInstance.products.del).toHaveBeenCalledWith('prod_to_delete');
    });

    it('存在しないProductの削除はスキップされる', async () => {
      mockStripeInstance.products.search.mockResolvedValue({ data: [] });

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'MissingProduct',
            path: 'TestStack/MissingProduct',
            type: 'Stripe::Product',
            properties: { name: 'Widget' },
          },
        ],
      };

      const result = await deployer.destroy(manifest);

      expect(result.destroyed).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(mockStripeInstance.products.del).not.toHaveBeenCalled();
    });

    it('Priceを無効化する（Stripeでは削除不可）', async () => {
      mockStripeInstance.prices.search.mockResolvedValue({
        data: [{ id: 'price_to_deactivate' }],
      });
      mockStripeInstance.prices.update.mockResolvedValue({});

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'MyPrice',
            path: 'TestStack/MyPrice',
            type: 'Stripe::Price',
            properties: { product: 'prod_123', currency: 'usd' },
          },
        ],
      };

      const result = await deployer.destroy(manifest);

      expect(result.destroyed).toHaveLength(1);
      expect(result.destroyed[0].status).toBe('deactivated');
      expect(mockStripeInstance.prices.update).toHaveBeenCalledWith(
        'price_to_deactivate',
        { active: false }
      );
    });

    it('Couponを削除する', async () => {
      mockStripeInstance.coupons.retrieve.mockResolvedValue({
        id: 'COUPON1',
      });
      mockStripeInstance.coupons.del.mockResolvedValue({});

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'COUPON1',
            path: 'TestStack/COUPON1',
            type: 'Stripe::Coupon',
            properties: { duration: 'once' },
          },
        ],
      };

      const result = await deployer.destroy(manifest);

      expect(result.destroyed).toHaveLength(1);
      expect(result.destroyed[0]).toEqual({
        id: 'COUPON1',
        type: 'Stripe::Coupon',
        status: 'deleted',
      });
    });

    it('存在しないCouponの削除はスキップされる', async () => {
      const notFoundError = new Error('No such coupon');
      Object.assign(notFoundError, { code: 'resource_missing' });
      mockStripeInstance.coupons.retrieve.mockRejectedValue(notFoundError);

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'GONE',
            path: 'TestStack/GONE',
            type: 'Stripe::Coupon',
            properties: { duration: 'once' },
          },
        ],
      };

      const result = await deployer.destroy(manifest);

      expect(result.destroyed).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(mockStripeInstance.coupons.del).not.toHaveBeenCalled();
    });

    it('リソースが逆順で削除される', async () => {
      // 依存関係: Product → Price の順で定義、破壊は逆順
      mockStripeInstance.prices.search.mockResolvedValue({
        data: [{ id: 'price_1' }],
      });
      mockStripeInstance.prices.update.mockResolvedValue({});
      mockStripeInstance.products.search.mockResolvedValue({
        data: [{ id: 'prod_1' }],
      });
      mockStripeInstance.products.del.mockResolvedValue({});

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'MyProduct',
            path: 'TestStack/MyProduct',
            type: 'Stripe::Product',
            properties: { name: 'Widget' },
          },
          {
            id: 'MyPrice',
            path: 'TestStack/MyPrice',
            type: 'Stripe::Price',
            properties: { product: 'prod_1', currency: 'usd' },
          },
        ],
      };

      const result = await deployer.destroy(manifest);

      expect(result.destroyed).toHaveLength(2);
      // Priceが先に処理される（逆順）
      expect(result.destroyed[0].id).toBe('MyPrice');
      expect(result.destroyed[1].id).toBe('MyProduct');
    });

    it('destroy中のエラーがerrors配列に記録される', async () => {
      mockStripeInstance.products.search.mockRejectedValue(
        new Error('API Error')
      );

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'BadProduct',
            path: 'TestStack/BadProduct',
            type: 'Stripe::Product',
            properties: { name: 'Widget' },
          },
        ],
      };

      const result = await deployer.destroy(manifest);

      expect(result.destroyed).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('API Error');
    });
  });

  describe('search queryのエスケープ', () => {
    it('論理IDにダブルクォートが含まれる場合にエスケープされる', async () => {
      mockStripeInstance.products.search.mockResolvedValue({ data: [] });
      mockStripeInstance.products.create.mockResolvedValue({ id: 'prod_1' });

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'Product"WithQuotes',
            path: 'TestStack/Product"WithQuotes',
            type: 'Stripe::Product',
            properties: { name: 'Test' },
          },
        ],
      };

      await deployer.deploy(manifest);

      expect(mockStripeInstance.products.search).toHaveBeenCalledWith({
        query: expect.stringContaining('Product\\"WithQuotes'),
        limit: 1,
      });
    });

    it('論理IDにバックスラッシュが含まれる場合にエスケープされる', async () => {
      mockStripeInstance.products.search.mockResolvedValue({ data: [] });
      mockStripeInstance.products.create.mockResolvedValue({ id: 'prod_1' });

      const manifest: StackManifest = {
        stackId: 'TestStack',
        tags: {},
        resources: [
          {
            id: 'Product\\Path',
            path: 'TestStack/Product\\Path',
            type: 'Stripe::Product',
            properties: { name: 'Test' },
          },
        ],
      };

      await deployer.deploy(manifest);

      expect(mockStripeInstance.products.search).toHaveBeenCalledWith({
        query: expect.stringContaining('Product\\\\Path'),
        limit: 1,
      });
    });
  });
});
