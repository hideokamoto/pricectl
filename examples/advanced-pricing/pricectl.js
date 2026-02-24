"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@pricectl/core");
const constructs_1 = require("@pricectl/constructs");
/**
 * Advanced Pricing Example
 *
 * This example demonstrates advanced pricing strategies:
 * - Tiered pricing (volume discounts)
 * - Metered billing (usage-based)
 * - Graduated pricing
 * - Per-seat pricing
 */
const stack = new core_1.Stack(undefined, 'AdvancedPricingStack', {
    description: 'Advanced pricing strategies for various business models',
});
// ============================================================================
// TIERED PRICING - API Calls
// ============================================================================
const apiProduct = new constructs_1.Product(stack, 'APIProduct', {
    name: 'API Access',
    description: 'Pay-as-you-go API access with volume discounts',
    active: true,
    unitLabel: 'API call',
});
// Graduated pricing: cheaper as you use more
new constructs_1.Price(stack, 'APIGraduatedPrice', {
    product: apiProduct,
    currency: 'usd',
    recurring: {
        interval: 'month',
        usageType: 'metered',
    },
    tiersMode: 'graduated',
    tiers: [
        {
            upTo: 1000,
            unitAmount: 10, // $0.10 per call for first 1,000 calls
        },
        {
            upTo: 10000,
            unitAmount: 5, // $0.05 per call for next 9,000 calls
        },
        {
            upTo: 'inf',
            unitAmount: 2, // $0.02 per call for everything beyond 10,000
        },
    ],
    nickname: 'API Calls - Graduated',
});
// Volume pricing: same rate for ALL units at a tier
new constructs_1.Price(stack, 'APIVolumePrice', {
    product: apiProduct,
    currency: 'usd',
    recurring: {
        interval: 'month',
        usageType: 'metered',
    },
    tiersMode: 'volume',
    tiers: [
        {
            upTo: 1000,
            unitAmount: 10, // $0.10 per call if total ≤ 1,000
        },
        {
            upTo: 10000,
            unitAmount: 7, // $0.07 per call if 1,001 ≤ total ≤ 10,000
        },
        {
            upTo: 'inf',
            unitAmount: 3, // $0.03 per call if total > 10,000
        },
    ],
    nickname: 'API Calls - Volume',
});
// ============================================================================
// PER-SEAT PRICING
// ============================================================================
const teamProduct = new constructs_1.Product(stack, 'TeamProduct', {
    name: 'Team Collaboration',
    description: 'Collaborate with your team',
    active: true,
    unitLabel: 'seat',
});
// Per-seat monthly pricing
new constructs_1.Price(stack, 'PerSeatMonthly', {
    product: teamProduct,
    currency: 'usd',
    unitAmount: 1500, // $15 per seat per month
    recurring: {
        interval: 'month',
        usageType: 'licensed',
    },
    nickname: 'Per Seat - Monthly',
});
// Per-seat yearly pricing (with discount)
new constructs_1.Price(stack, 'PerSeatYearly', {
    product: teamProduct,
    currency: 'usd',
    unitAmount: 15000, // $150 per seat per year (save ~17%)
    recurring: {
        interval: 'year',
        usageType: 'licensed',
    },
    nickname: 'Per Seat - Yearly',
});
// ============================================================================
// METERED BILLING - Storage
// ============================================================================
const storageProduct = new constructs_1.Product(stack, 'StorageProduct', {
    name: 'Cloud Storage',
    description: 'Scalable cloud storage with usage-based billing',
    active: true,
    unitLabel: 'GB',
});
// Metered storage pricing (charged monthly based on usage)
new constructs_1.Price(stack, 'StorageMetered', {
    product: storageProduct,
    currency: 'usd',
    unitAmount: 20, // $0.20 per GB per month
    recurring: {
        interval: 'month',
        usageType: 'metered',
    },
    nickname: 'Storage - Metered',
});
// Storage with graduated tiers
new constructs_1.Price(stack, 'StorageGraduated', {
    product: storageProduct,
    currency: 'usd',
    recurring: {
        interval: 'month',
        usageType: 'metered',
    },
    tiersMode: 'graduated',
    tiers: [
        {
            upTo: 100,
            unitAmount: 50, // $0.50/GB for first 100 GB
        },
        {
            upTo: 1000,
            unitAmount: 30, // $0.30/GB for 100-1,000 GB
        },
        {
            upTo: 'inf',
            unitAmount: 20, // $0.20/GB for > 1,000 GB
        },
    ],
    nickname: 'Storage - Graduated Tiers',
});
// ============================================================================
// HYBRID MODEL - Base + Usage
// ============================================================================
const hybridProduct = new constructs_1.Product(stack, 'HybridProduct', {
    name: 'Professional Service',
    description: 'Base subscription with usage-based add-ons',
    active: true,
});
// Base monthly subscription
new constructs_1.Price(stack, 'HybridBase', {
    product: hybridProduct,
    currency: 'usd',
    unitAmount: 4999, // $49.99 base fee
    recurring: {
        interval: 'month',
        usageType: 'licensed',
    },
    nickname: 'Base Subscription',
});
// Usage component (charged in addition to base)
const usageProduct = new constructs_1.Product(stack, 'UsageProduct', {
    name: 'Additional Usage',
    description: 'Usage beyond included quota',
    active: true,
    unitLabel: 'unit',
});
new constructs_1.Price(stack, 'AdditionalUsage', {
    product: usageProduct,
    currency: 'usd',
    unitAmount: 100, // $1.00 per additional unit
    recurring: {
        interval: 'month',
        usageType: 'metered',
    },
    nickname: 'Overage Charges',
});
// ============================================================================
// TRANSFORM QUANTITY - Charge per 100 units
// ============================================================================
const bulkProduct = new constructs_1.Product(stack, 'BulkProduct', {
    name: 'Bulk Processing',
    description: 'Charged per 100 processed items',
    active: true,
    unitLabel: 'batch (100 items)',
});
new constructs_1.Price(stack, 'BulkPrice', {
    product: bulkProduct,
    currency: 'usd',
    unitAmount: 500, // $5.00 per 100 items
    recurring: {
        interval: 'month',
        usageType: 'metered',
    },
    transformQuantity: {
        divideBy: 100,
        round: 'up', // Round up to ensure partial batches are charged
    },
    nickname: 'Bulk Processing',
});
exports.default = stack;
