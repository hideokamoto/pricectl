"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@pricectl/core");
const constructs_1 = require("@pricectl/constructs");
/**
 * Basic Subscription Example
 *
 * This example demonstrates how to create a simple SaaS subscription
 * with multiple pricing tiers and promotional coupons.
 */
const stack = new core_1.Stack(undefined, 'BasicSubscriptionStack', {
    description: 'Basic SaaS subscription infrastructure',
    tags: {
        environment: 'production',
        team: 'billing',
    },
});
// Create a product for the Basic tier
const basicProduct = new constructs_1.Product(stack, 'BasicProduct', {
    name: 'Basic Plan',
    description: 'Perfect for individuals and small teams',
    active: true,
    statementDescriptor: 'MYAPP BASIC',
});
// Monthly price for Basic tier
new constructs_1.Price(stack, 'BasicMonthly', {
    product: basicProduct,
    currency: 'usd',
    unitAmount: 999, // $9.99
    recurring: {
        interval: 'month',
    },
    nickname: 'Basic Monthly',
    active: true,
});
// Yearly price for Basic tier (with discount)
new constructs_1.Price(stack, 'BasicYearly', {
    product: basicProduct,
    currency: 'usd',
    unitAmount: 9999, // $99.99 (save ~17%)
    recurring: {
        interval: 'year',
    },
    nickname: 'Basic Yearly',
    active: true,
});
// Create a product for the Pro tier
const proProduct = new constructs_1.Product(stack, 'ProProduct', {
    name: 'Pro Plan',
    description: 'For growing businesses with advanced needs',
    active: true,
    statementDescriptor: 'MYAPP PRO',
});
// Monthly price for Pro tier
new constructs_1.Price(stack, 'ProMonthly', {
    product: proProduct,
    currency: 'usd',
    unitAmount: 2999, // $29.99
    recurring: {
        interval: 'month',
    },
    nickname: 'Pro Monthly',
    active: true,
});
// Yearly price for Pro tier
new constructs_1.Price(stack, 'ProYearly', {
    product: proProduct,
    currency: 'usd',
    unitAmount: 29999, // $299.99 (save ~17%)
    recurring: {
        interval: 'year',
    },
    nickname: 'Pro Yearly',
    active: true,
});
// Create a product for the Enterprise tier
const enterpriseProduct = new constructs_1.Product(stack, 'EnterpriseProduct', {
    name: 'Enterprise Plan',
    description: 'Custom solutions for large organizations',
    active: true,
    statementDescriptor: 'MYAPP ENTERPRISE',
});
// Monthly price for Enterprise tier
new constructs_1.Price(stack, 'EnterpriseMonthly', {
    product: enterpriseProduct,
    currency: 'usd',
    unitAmount: 9999, // $99.99
    recurring: {
        interval: 'month',
    },
    nickname: 'Enterprise Monthly',
    active: true,
});
// Promotional Coupons
// First-time customer discount
new constructs_1.Coupon(stack, 'WelcomeCoupon', {
    name: 'Welcome Discount',
    percentOff: 20,
    duration: 'once',
    metadata: {
        campaign: 'welcome-2024',
    },
});
// Limited-time promotion
new constructs_1.Coupon(stack, 'SummerSale', {
    name: 'Summer Sale 2024',
    percentOff: 30,
    duration: 'repeating',
    durationInMonths: 3,
    maxRedemptions: 1000,
    metadata: {
        campaign: 'summer-2024',
    },
});
// Annual upgrade incentive
new constructs_1.Coupon(stack, 'AnnualUpgrade', {
    name: 'Annual Upgrade Discount',
    percentOff: 15,
    duration: 'forever',
    metadata: {
        campaign: 'annual-upgrade',
    },
});
exports.default = stack;
