import { Construct, Resource, ResourceProps } from '@pricectl/core';
import type Stripe from 'stripe';

export interface ProductProps extends ResourceProps {
  /**
   * The product's name, meant to be displayable to the customer.
   */
  readonly name: string;

  /**
   * Whether the product is currently available for purchase.
   * @default true
   */
  readonly active?: boolean;

  /**
   * The product's description, meant to be displayable to the customer.
   */
  readonly description?: string;

  /**
   * A list of up to 8 URLs of images for this product, meant to be displayable to the customer.
   */
  readonly images?: string[];

  /**
   * Set of key-value pairs that you can attach to an object.
   */
  readonly metadata?: Record<string, string>;

  /**
   * A URL of a publicly-accessible webpage for this product.
   */
  readonly url?: string;

  /**
   * A label that represents units of this product.
   */
  readonly unitLabel?: string;

  /**
   * An arbitrary string to be displayed on your customer's credit card or bank statement.
   */
  readonly statementDescriptor?: string;

  /**
   * A tax code ID.
   */
  readonly taxCode?: string;
}

/**
 * Represents a Stripe Product
 *
 * @example
 * ```ts
 * new Product(stack, 'MyProduct', {
 *   name: 'Premium Subscription',
 *   description: 'Access to premium features',
 *   active: true,
 * });
 * ```
 */
export class Product extends Resource {
  public readonly name: string;
  public readonly active: boolean;
  public readonly description?: string;
  public readonly images?: string[];
  public readonly metadata?: Record<string, string>;
  public readonly url?: string;
  public readonly unitLabel?: string;
  public readonly statementDescriptor?: string;
  public readonly taxCode?: string;

  constructor(scope: Construct, id: string, props: ProductProps) {
    super(scope, id, props);

    this.name = props.name;
    this.active = props.active ?? true;
    this.description = props.description;
    this.images = props.images;
    this.metadata = props.metadata;
    this.url = props.url;
    this.unitLabel = props.unitLabel;
    this.statementDescriptor = props.statementDescriptor;
    this.taxCode = props.taxCode;

    // Register resource metadata after all properties are initialized
    this.registerResourceMetadata();
  }

  protected get resourceType(): string {
    return 'Stripe::Product';
  }

  protected synthesizeProperties(): Record<string, unknown> {
    const params: Stripe.ProductCreateParams = {
      name: this.name,
      active: this.active,
    };

    if (this.description !== undefined) params.description = this.description;
    if (this.images !== undefined) params.images = this.images;
    if (this.metadata !== undefined) params.metadata = this.metadata;
    if (this.url !== undefined) params.url = this.url;
    if (this.unitLabel !== undefined) params.unit_label = this.unitLabel;
    if (this.statementDescriptor !== undefined) params.statement_descriptor = this.statementDescriptor;
    if (this.taxCode !== undefined) params.tax_code = this.taxCode;

    return params as unknown as Record<string, unknown>;
  }
}
