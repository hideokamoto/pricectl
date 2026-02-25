import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import Stripe from 'stripe';
import { StackManifest } from '@pricectl/core';

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
    } catch (error: any) {
      this.error(`Diff failed: ${error.message}`);
    }
  }

  /**
   * Fetch the current state of a resource from Stripe.
   * Uses the search API for efficient metadata-based lookup.
   */
  private async fetchCurrentResource(stripe: Stripe, resource: any): Promise<any> {
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
    } catch (error: any) {
      // Only return null for resource_missing errors
      if (error.code === 'resource_missing') {
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
  private normalizeResource(resource: any, resourceType: string): any {
    const normalized: any = {};

    switch (resourceType) {
      case 'Stripe::Product':
        // Include all Product properties
        if (resource.name !== undefined) normalized.name = resource.name;
        if (resource.description !== undefined) normalized.description = resource.description;
        if (resource.active !== undefined) normalized.active = resource.active;
        if (resource.images) normalized.images = resource.images;
        if (resource.url !== undefined) normalized.url = resource.url;
        if (resource.unit_label !== undefined) normalized.unit_label = resource.unit_label;
        if (resource.statement_descriptor !== undefined) {
          normalized.statement_descriptor = resource.statement_descriptor;
        }
        if (resource.tax_code !== undefined) normalized.tax_code = resource.tax_code;
        // Exclude pricectl and legacy fillet metadata from comparison
        if (resource.metadata) {
          const { pricectl_id: _pid, pricectl_path: _ppath, fillet_id: _fid, fillet_path: _fpath, ...userMetadata } = resource.metadata;
          if (Object.keys(userMetadata).length > 0) {
            normalized.metadata = userMetadata;
          }
        }
        break;

      case 'Stripe::Price':
        // Include all Price properties
        // Note: product ID is already resolved, so we include it as-is
        if (resource.product !== undefined) normalized.product = resource.product;
        if (resource.currency !== undefined) normalized.currency = resource.currency;
        if (resource.unit_amount !== undefined) normalized.unit_amount = resource.unit_amount;
        if (resource.unit_amount_decimal !== undefined) {
          normalized.unit_amount_decimal = resource.unit_amount_decimal;
        }
        if (resource.active !== undefined) normalized.active = resource.active;
        if (resource.nickname !== undefined) normalized.nickname = resource.nickname;
        if (resource.lookup_key !== undefined) normalized.lookup_key = resource.lookup_key;

        // Recurring properties
        if (resource.recurring) {
          normalized.recurring = {};
          if (resource.recurring.interval !== undefined) {
            normalized.recurring.interval = resource.recurring.interval;
          }
          if (resource.recurring.interval_count !== undefined) {
            normalized.recurring.interval_count = resource.recurring.interval_count;
          }
          if (resource.recurring.usage_type !== undefined) {
            normalized.recurring.usage_type = resource.recurring.usage_type;
          }
          if (resource.recurring.trial_period_days !== undefined) {
            normalized.recurring.trial_period_days = resource.recurring.trial_period_days;
          }
        }

        // Tiers
        if (resource.tiers_mode !== undefined) normalized.tiers_mode = resource.tiers_mode;
        if (resource.tiers) {
          normalized.tiers = resource.tiers.map((tier: any) => ({
            up_to: tier.up_to,
            unit_amount: tier.unit_amount,
            flat_amount: tier.flat_amount,
          }));
        }

        // Transform quantity
        if (resource.transform_quantity) {
          normalized.transform_quantity = {
            divide_by: resource.transform_quantity.divide_by,
            round: resource.transform_quantity.round,
          };
        }

        // Exclude pricectl and legacy fillet metadata from comparison
        if (resource.metadata) {
          const { pricectl_id: _pid, pricectl_path: _ppath, fillet_id: _fid, fillet_path: _fpath, ...userMetadata } = resource.metadata;
          if (Object.keys(userMetadata).length > 0) {
            normalized.metadata = userMetadata;
          }
        }
        break;

      case 'Stripe::Coupon':
        // Include all Coupon properties
        if (resource.duration !== undefined) normalized.duration = resource.duration;
        if (resource.amount_off !== undefined) normalized.amount_off = resource.amount_off;
        if (resource.currency !== undefined) normalized.currency = resource.currency;
        if (resource.percent_off !== undefined) normalized.percent_off = resource.percent_off;
        if (resource.duration_in_months !== undefined) {
          normalized.duration_in_months = resource.duration_in_months;
        }
        if (resource.max_redemptions !== undefined) {
          normalized.max_redemptions = resource.max_redemptions;
        }
        if (resource.name !== undefined) normalized.name = resource.name;
        if (resource.redeem_by !== undefined) normalized.redeem_by = resource.redeem_by;
        if (resource.applies_to !== undefined) normalized.applies_to = resource.applies_to;
        if (resource.metadata) normalized.metadata = resource.metadata;
        break;
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
