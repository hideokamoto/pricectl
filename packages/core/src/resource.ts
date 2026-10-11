import { Construct } from './construct';
import { Stack } from './stack';
import { DUPLICATE_RESOURCE_ID_ERROR } from './errors';

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
      properties: this.synthesizeProperties(),
    });
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
    const clash = this.stack.node
      .findAll()
      .find((c) => c !== this && c instanceof Resource && c.node.id === this.node.id);
    if (clash) {
      throw new Error(DUPLICATE_RESOURCE_ID_ERROR(this.node.id, clash.node.path, this.node.path));
    }
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
