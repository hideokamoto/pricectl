import { Construct } from './construct';
import { DUPLICATE_RESOURCE_ID_ERROR, STRIPE_API_KEY_MISSING_ERROR } from './errors';
import { checkManifest } from './manifest-checks';

/**
 * The Stripe API version pricectl uses unless a stack sets one: the version that the
 * stripe-node release pricectl depends on is built for.
 */
export const DEFAULT_STRIPE_API_VERSION = '2026-09-30.endive';

export interface StackProps {
  /**
   * Stripe API key (secret key)
   */
  readonly apiKey?: string;

  /**
   * Stripe API version (e.g., '2026-09-30.endive').
   * Defaults to DEFAULT_STRIPE_API_VERSION.
   */
  readonly apiVersion?: string;

  /**
   * Stack description
   */
  readonly description?: string;

  /**
   * Tags to apply to all resources in this stack, as Stripe metadata.
   * A resource's own metadata takes precedence over a tag with the same key.
   * Resources without metadata support (billing meters) are not tagged.
   */
  readonly tags?: Record<string, string>;
}

/**
 * A Stack is a collection of Stripe resources that can be deployed together.
 * Similar to AWS CDK's Stack concept.
 */
export class Stack extends Construct {
  private readonly _apiKey?: string;
  public readonly apiVersion?: string;
  public readonly description?: string;
  public readonly tags: Record<string, string>;
  /** Path of each resource in this stack, by resource id */
  private readonly resourcePaths = new Map<string, string>();

  /** The Stripe API key; not included in toJSON(). */
  get apiKey(): string | undefined {
    return this._apiKey;
  }

  /**
   * @param scope parent construct, or undefined for a root stack
   * @param id stack ID
   * @param props stack properties
   */
  constructor(scope: Construct | undefined, id: string, props: StackProps = {}) {
    super(scope, id);

    this._apiKey = props.apiKey || process.env.STRIPE_SECRET_KEY;
    this.apiVersion = props.apiVersion || DEFAULT_STRIPE_API_VERSION;
    this.description = props.description;
    this.tags = props.tags || {};

    if (!this._apiKey) {
      throw new Error(STRIPE_API_KEY_MISSING_ERROR);
    }
  }

  /**
   * Record a resource id, which must be unique within the stack because resources are
   * identified in Stripe and in pricectl.lock.json by id alone. Called by Resource.
   * @internal
   */
  public registerResourceId(id: string, path: string): void {
    const existingPath = this.resourcePaths.get(id);
    if (existingPath !== undefined) {
      throw new Error(DUPLICATE_RESOURCE_ID_ERROR(id, existingPath, path));
    }
    this.resourcePaths.set(id, path);
  }

  /** Stack settings for serialization, without the API key. */
  toJSON(): object {
    return {
      id: this.node.id,
      apiVersion: this.apiVersion,
      description: this.description,
      tags: this.tags,
    };
  }

  /**
   * Synthesize the stack into a deployable manifest
   */
  public synth(): StackManifest {
    const constructs = this.node.findAll();
    const resources: ResourceManifest[] = [];

    for (const construct of constructs) {
      if (construct === this) continue;

      const metadata = construct.node.getMetadata('resource') as StoredResourceMetadata | undefined;
      if (metadata) {
        // Read physicalId structurally: importing Resource here would create an import cycle
        const { physicalId, key, isDefault } = construct as unknown as {
          physicalId?: string;
          key: string;
          isDefault?: boolean;
        };
        resources.push({
          id: construct.node.id,
          key,
          path: construct.node.path,
          type: metadata.type,
          properties: metadata.properties,
          ...(physicalId ? { physicalId } : {}),
          ...(isDefault ? { isDefault } : {}),
        });
      }
    }

    const manifest: StackManifest = {
      stackId: this.node.id,
      apiVersion: this.apiVersion,
      description: this.description,
      tags: this.tags,
      resources,
    };
    const problems = checkManifest(manifest);
    if (problems.length > 0) {
      throw new Error(`The definition of stack "${this.node.id}" has problems:\n` + problems.map((p) => `  - ${p}`).join('\n'));
    }
    return manifest;
  }
}

/** Shape stored by Resource.registerResourceMetadata() */
interface StoredResourceMetadata {
  type: string;
  properties: Record<string, unknown>;
}

export interface ResourceManifest {
  id: string;
  /** The name pricectl finds the resource by in Stripe: `{stackId}_{logicalId}` */
  key: string;
  path: string;
  type: string;
  properties: Record<string, unknown>;
  /** ID of an existing Stripe object this resource manages, when given in the construct props */
  physicalId?: string;
  /** Set on a price declared as the default price of its product */
  isDefault?: boolean;
}

export interface StackManifest {
  stackId: string;
  apiVersion?: string;
  description?: string;
  tags: Record<string, string>;
  resources: ResourceManifest[];
}
