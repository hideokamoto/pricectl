import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import Stripe from 'stripe';
import { StackManifest, ResourceManifest } from '@pricectl/core';

export default class Diff extends Command {
  static description = 'Compare the deployed stack with the local definition';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
  ];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Diff);

    this.log('Computing diff...');
    this.log('');

    const appPath = path.resolve(process.cwd(), flags.app);

    // Pre-flight checks outside try block to preserve error messages
    if (!fs.existsSync(appPath)) {
      this.error(`App file not found: ${appPath}`, { exit: 1 });
    }

    // Load and synthesize the stack (validation outside try block)
    const appModule = require(appPath);
    const stack = appModule.default || appModule.stack || appModule;

    if (!stack || typeof stack.synth !== 'function') {
      this.error('App must export a Stack instance with a synth() method', { exit: 1 });
    }

    const manifest: StackManifest = stack.synth();

    // Get Stripe API key
    const apiKey = stack.apiKey || process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      this.error('Stripe API key not found. Set STRIPE_SECRET_KEY environment variable.', { exit: 1 });
    }

    try {

      const stripe = new Stripe(apiKey, { apiVersion: '2023-10-16' });

      // Fetch current state from Stripe
      this.log(chalk.bold(`Stack: ${manifest.stackId}`));
      this.log('');

      let hasChanges = false;

      for (const resource of manifest.resources) {
        const current = await this.fetchCurrentResource(stripe, resource);

        if (!current) {
          this.log(chalk.green(`[+] ${resource.path} [${resource.type}]`));
          this.log(chalk.gray('    Will be created'));
          this.log('');
          hasChanges = true;
          continue;
        }

        // Compare properties
        const desired = JSON.stringify(resource.properties, null, 2);
        const existing = JSON.stringify(this.normalizeResource(current, resource.type), null, 2);

        if (desired !== existing) {
          this.log(chalk.yellow(`[~] ${resource.path} [${resource.type}]`));
          const patch = createTwoFilesPatch(
            'current',
            'desired',
            existing,
            desired,
            '',
            ''
          );
          this.log(this.colorDiff(patch));
          this.log('');
          hasChanges = true;
        }
      }

      if (!hasChanges) {
        this.log(chalk.gray('No changes detected'));
      }
    } catch (error: unknown) {
      this.error(`Diff failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetch the current state of a resource from Stripe.
   * Uses the search API for efficient metadata-based lookup.
   */
  private async fetchCurrentResource(
    stripe: Stripe,
    resource: ResourceManifest
  ): Promise<Stripe.Product | Stripe.Price | Stripe.Coupon | null> {
    try {
      // Escape backslashes first, then escape double quotes in resource.id to prevent search query injection
      const escapedId = resource.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      switch (resource.type) {
        case 'Stripe::Product': {
          const result = await stripe.products.search({
            query: `metadata["pricectl_id"]:"${escapedId}" OR metadata["fillet_id"]:"${escapedId}"`,
            limit: 1,
          });
          return result.data.length > 0 ? result.data[0] : null;
        }
        case 'Stripe::Price': {
          const result = await stripe.prices.search({
            query: `metadata["pricectl_id"]:"${escapedId}" OR metadata["fillet_id"]:"${escapedId}"`,
            limit: 1,
          });
          return result.data.length > 0 ? result.data[0] : null;
        }
        case 'Stripe::Coupon': {
          return await stripe.coupons.retrieve(resource.id);
        }
        default:
          return null;
      }
    } catch (error: unknown) {
      // Only return null for resource_missing errors
      if (error instanceof Stripe.errors.StripeError && error.code === 'resource_missing') {
        return null;
      }
      // Re-throw other errors (auth, network, etc.) to surface them to the user
      throw error;
    }
  }

  /**
   * Normalize a Stripe resource to match the format of our construct properties.
   * This ensures accurate comparison by extracting all user-configurable properties.
   */
  private normalizeResource(
    resource: Stripe.Product | Stripe.Price | Stripe.Coupon,
    resourceType: string
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};

    switch (resourceType) {
      case 'Stripe::Product': {
        const product = resource as Stripe.Product;
        // Include all Product properties
        if (product.name !== undefined) normalized.name = product.name;
        if (product.description !== undefined) normalized.description = product.description;
        if (product.active !== undefined) normalized.active = product.active;
        if (product.images) normalized.images = product.images;
        if (product.url !== undefined) normalized.url = product.url;
        if (product.unit_label !== undefined) normalized.unit_label = product.unit_label;
        if (product.statement_descriptor !== undefined) {
          normalized.statement_descriptor = product.statement_descriptor;
        }
        if (product.tax_code !== undefined) normalized.tax_code = product.tax_code;
        // Exclude pricectl and legacy fillet metadata from comparison
        if (product.metadata) {
          const { pricectl_id: _pid, pricectl_path: _ppath, fillet_id: _fid, fillet_path: _fpath, ...userMetadata } = product.metadata;
          if (Object.keys(userMetadata).length > 0) {
            normalized.metadata = userMetadata;
          }
        }
        break;
      }

      case 'Stripe::Price': {
        const price = resource as Stripe.Price;
        // Include all Price properties
        // Note: product ID is already resolved, so we include it as-is
        if (price.product !== undefined) normalized.product = price.product;
        if (price.currency !== undefined) normalized.currency = price.currency;
        if (price.unit_amount !== undefined) normalized.unit_amount = price.unit_amount;
        if (price.unit_amount_decimal !== undefined) {
          normalized.unit_amount_decimal = price.unit_amount_decimal;
        }
        if (price.active !== undefined) normalized.active = price.active;
        if (price.nickname !== undefined) normalized.nickname = price.nickname;
        if (price.lookup_key !== undefined) normalized.lookup_key = price.lookup_key;

        // Recurring properties
        if (price.recurring) {
          const recurring: Record<string, unknown> = {};
          if (price.recurring.interval !== undefined) {
            recurring.interval = price.recurring.interval;
          }
          if (price.recurring.interval_count !== undefined) {
            recurring.interval_count = price.recurring.interval_count;
          }
          if (price.recurring.usage_type !== undefined) {
            recurring.usage_type = price.recurring.usage_type;
          }
          if (price.recurring.trial_period_days !== undefined) {
            recurring.trial_period_days = price.recurring.trial_period_days;
          }
          normalized.recurring = recurring;
        }

        // Tiers
        if (price.tiers_mode !== undefined) normalized.tiers_mode = price.tiers_mode;
        if (price.tiers) {
          normalized.tiers = price.tiers.map((tier: Stripe.Price.Tier) => ({
            up_to: tier.up_to,
            unit_amount: tier.unit_amount,
            flat_amount: tier.flat_amount,
          }));
        }

        // Transform quantity
        if (price.transform_quantity) {
          normalized.transform_quantity = {
            divide_by: price.transform_quantity.divide_by,
            round: price.transform_quantity.round,
          };
        }

        // Exclude pricectl and legacy fillet metadata from comparison
        if (price.metadata) {
          const { pricectl_id: _pid, pricectl_path: _ppath, fillet_id: _fid, fillet_path: _fpath, ...userMetadata } = price.metadata;
          if (Object.keys(userMetadata).length > 0) {
            normalized.metadata = userMetadata;
          }
        }
        break;
      }

      case 'Stripe::Coupon': {
        const coupon = resource as Stripe.Coupon;
        // Include all Coupon properties
        if (coupon.duration !== undefined) normalized.duration = coupon.duration;
        if (coupon.amount_off !== undefined) normalized.amount_off = coupon.amount_off;
        if (coupon.currency !== undefined) normalized.currency = coupon.currency;
        if (coupon.percent_off !== undefined) normalized.percent_off = coupon.percent_off;
        if (coupon.duration_in_months !== undefined) {
          normalized.duration_in_months = coupon.duration_in_months;
        }
        if (coupon.max_redemptions !== undefined) {
          normalized.max_redemptions = coupon.max_redemptions;
        }
        if (coupon.name !== undefined) normalized.name = coupon.name;
        if (coupon.redeem_by !== undefined) normalized.redeem_by = coupon.redeem_by;
        if (coupon.applies_to !== undefined) normalized.applies_to = coupon.applies_to;
        if (coupon.metadata) normalized.metadata = coupon.metadata;
        break;
      }
    }

    return normalized;
  }

  private colorDiff(patch: string): string {
    return patch.split('\n').map(line => {
      if (line.startsWith('+')) return chalk.green(line);
      if (line.startsWith('-')) return chalk.red(line);
      if (line.startsWith('@@')) return chalk.cyan(line);
      return chalk.gray(line);
    }).join('\n');
  }
}
