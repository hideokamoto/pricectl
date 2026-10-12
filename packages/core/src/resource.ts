import { Construct } from './construct';
import { Stack } from './stack';

export interface ResourceProps {
  /**
   * Physical ID of the resource (if it already exists in Stripe)
   */
  readonly physicalId?: string;
}

/**
 * Base class for all Stripe resources
 */
export abstract class Resource extends Construct {
  /**
   * The physical ID of this resource in Stripe
   */
  public physicalId?: string;

  /**
   * The stack this resource belongs to
   */
  public readonly stack: Stack;

  /**
   * The name pricectl finds this resource by in Stripe: `{stackId}_{logicalId}`.
   * It is the ID of a product or coupon, and the default lookup key of a price.
   */
  public get key(): string {
    return `${this.stack.node.id}_${this.node.id}`;
  }

  /**
   * @param scope construct this resource belongs to; a Stack must be among its ancestors
   * @param id logical ID, unique within the stack
   * @param props resource properties
   */
  constructor(scope: Construct, id: string, props: ResourceProps = {}) {
    super(scope, id);

    this.physicalId = props.physicalId;
    this.stack = this.findStack();
    this.assertUniqueLogicalId();

    // Note: Resource metadata registration is deferred to subclasses
    // to ensure all properties are initialized before synthesizeProperties() is called.
    // Subclasses should call registerResourceMetadata() at the end of their constructor.
  }

  /**
   * Register this resource's metadata.
   * Subclasses should call this method at the end of their constructor
   * after all properties have been initialized.
   */
  protected registerResourceMetadata(): void {
    this.node.addMetadata('resource', {
      type: this.resourceType,
      properties: this.withStackTags(this.synthesizeProperties()),
    });
  }

  /**
   * Whether the Stripe object supports metadata. Stack tags are applied as metadata,
   * so resources without metadata (e.g. billing meters) override this to return false.
   */
  protected get supportsMetadata(): boolean {
    return true;
  }

  /** Apply the stack's tags as metadata; the resource's own metadata wins on conflicts. */
  private withStackTags(properties: Record<string, unknown>): Record<string, unknown> {
    if (!this.supportsMetadata || Object.keys(this.stack.tags).length === 0) {
      return properties;
    }
    const own = (properties.metadata ?? {}) as Record<string, string>;
    return { ...properties, metadata: { ...this.stack.tags, ...own } };
  }

  /**
   * The Stripe resource type (e.g., "Product", "Price", "Coupon")
   */
  protected abstract get resourceType(): string;

  /**
   * Synthesize the properties for this resource
   */
  protected abstract synthesizeProperties(): Record<string, unknown>;

  /**
   * Resources are identified in Stripe and in the state file by their id alone,
   * so the id must be unique within the whole stack, not only within its scope.
   */
  private assertUniqueLogicalId(): void {
    this.stack.registerResourceId(this.node.id, this.node.path);
  }

  /**
   * Find the Stack this resource belongs to
   */
  private findStack(): Stack {
    // Check if this resource itself is a stack (shouldn't happen, but check anyway)
    if (this instanceof Stack) {
      return this;
    }

    // Walk up the construct tree to find a Stack
    let scope: Construct | undefined = this.node.scope;
    while (scope) {
      if (scope instanceof Stack) {
        return scope;
      }
      scope = scope.node.scope;
    }

    throw new Error(`Resource ${this.node.path} must be created within a Stack`);
  }
}
