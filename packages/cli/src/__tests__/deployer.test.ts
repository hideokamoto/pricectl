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
    list: jest.fn(),
  },
  prices: {
    create: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },
  coupons: {
    create: jest.fn(),
    retrieve: jest.fn(),
    del: jest.fn(),
  },
};

/** Simulates the SDK's auto-paginating list result. */
function listOf<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

/** Simulates a list request that fails while paginating. */
function failingList(error: Error) {
  return {
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator]() {
      throw error;
    },
  };
}

/** Fields Stripe returns on objects that pricectl created for the given logical ID. */
function managedBy(logicalId: string) {
  return { metadata: { pricectl_id: logicalId }, active: true, created: 1700000000 };
}

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
        mockStripeInstance.products.list.mockReturnValue(listOf([]));
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
        mockStripeInstance.products.list.mockReturnValue(listOf([{ id: 'prod_existing_456', ...managedBy('MyProduct') }]));
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
        mockStripeInstance.prices.list.mockReturnValue(listOf([]));
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
          ...managedBy('MyPrice'),
          product: 'prod_123',
          currency: 'usd',
          unit_amount: 999,
          unit_amount_decimal: '999',
          active: true,
          billing_scheme: 'per_unit',
          nickname: null,
          recurring: null,
          tax_behavior: 'unspecified',
          tiers_mode: null,
          transform_quantity: null,
          lookup_key: null,
        };

        mockStripeInstance.prices.list.mockReturnValue(listOf([existingPrice]));

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

      it('tax_behaviorが異なるPriceは旧Priceを無効化して新規作成する', async () => {
        const existingPrice = {
          id: 'price_exclusive',
          ...managedBy('MyPrice'),
          product: 'prod_123',
          currency: 'usd',
          unit_amount: 999,
          unit_amount_decimal: undefined,
          active: true,
          nickname: undefined,
          tax_behavior: 'exclusive',
          recurring: null,
          tiers_mode: undefined,
          tiers: null,
          transform_quantity: null,
          lookup_key: undefined,
        };

        mockStripeInstance.prices.list.mockReturnValue(listOf([existingPrice]));
        mockStripeInstance.prices.update.mockResolvedValue({});
        mockStripeInstance.prices.create.mockResolvedValue({
          id: 'price_inclusive',
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
                tax_behavior: 'inclusive', // 変更
              },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed[0].status).toBe('created');
        expect(result.deployed[0].physicalId).toBe('price_inclusive');
        expect(mockStripeInstance.prices.update).toHaveBeenCalledWith(
          'price_exclusive',
          { active: false }
        );
      });

      it('tax_behaviorが同じPriceはunchangedになる', async () => {
        const existingPrice = {
          id: 'price_existing',
          ...managedBy('MyPrice'),
          product: 'prod_123',
          currency: 'usd',
          unit_amount: 999,
          unit_amount_decimal: '999',
          active: true,
          billing_scheme: 'per_unit',
          nickname: null,
          tax_behavior: 'inclusive',
          recurring: null,
          tiers_mode: null,
          transform_quantity: null,
          lookup_key: null,
        };

        mockStripeInstance.prices.list.mockReturnValue(listOf([existingPrice]));

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
                tax_behavior: 'inclusive',
              },
            },
          ],
        };

        const result = await deployer.deploy(manifest);

        expect(result.deployed[0].status).toBe('unchanged');
        expect(result.deployed[0].physicalId).toBe('price_existing');
      });

      it('変更ありのPriceは旧Priceを無効化して新規作成する', async () => {
        const existingPrice = {
          id: 'price_old',
          ...managedBy('MyPrice'),
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

        mockStripeInstance.prices.list.mockReturnValue(listOf([existingPrice]));
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
          duration: 'once',
          percent_off: 10,
          amount_off: null,
          currency: null,
          duration_in_months: null,
          max_redemptions: null,
          redeem_by: null,
          name: null,
          metadata: { pricectl_id: 'EXISTING' },
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
        mockStripeInstance.products.list.mockReturnValue(listOf([]));
        mockStripeInstance.products.create.mockResolvedValue({
          id: 'prod_resolved_abc',
        });

        // Price: 新規作成
        mockStripeInstance.prices.list.mockReturnValue(listOf([]));
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
        mockStripeInstance.products.list.mockReturnValue(failingList(new Error('Network failure')));

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
      mockStripeInstance.products.list.mockReturnValue(listOf([{ id: 'prod_to_delete', ...managedBy('MyProduct') }]));
      mockStripeInstance.prices.list.mockReturnValue(listOf([]));
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
      mockStripeInstance.products.list.mockReturnValue(listOf([]));

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
      mockStripeInstance.prices.list.mockReturnValue(listOf([{ id: 'price_to_deactivate', ...managedBy('MyPrice') }]));
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
      mockStripeInstance.prices.list.mockReturnValue(listOf([{ id: 'price_1', ...managedBy('MyPrice') }]));
      mockStripeInstance.prices.update.mockResolvedValue({});
      mockStripeInstance.products.list.mockReturnValue(listOf([{ id: 'prod_1', ...managedBy('MyProduct') }]));
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
      mockStripeInstance.products.list.mockReturnValue(failingList(new Error('API Error')));

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
});
