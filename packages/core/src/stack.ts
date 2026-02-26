import { Construct } from './construct';

export interface StackProps {
  /**
   * Stripe API key (secret key)
   */
  readonly apiKey?: string;

  /**
   * Stripe API version (e.g., '2024-12-18.acacia')
   * Defaults to the latest stable version if not specified
   */
  readonly apiVersion?: string;

  /**
   * Stack description
   */
  readonly description?: string;

  /**
   * Tags to apply to all resources in this stack
   */
  readonly tags?: Record<string, string>;
}

/**
 * A Stack is a collection of Stripe resources that can be deployed together.
 * Similar to AWS CDK's Stack concept.
 */
export class Stack extends Construct {
  public readonly apiKey?: string;
  public readonly apiVersion?: string;
  public readonly description?: string;
  public readonly tags: Record<string, string>;

  constructor(scope: Construct | undefined, id: string, props: StackProps = {}) {
    super(scope, id);

    this.apiKey = props.apiKey || process.env.STRIPE_SECRET_KEY;
    this.apiVersion = props.apiVersion || '2024-12-18.acacia';
    this.description = props.description;
    this.tags = props.tags || {};

    if (!this.apiKey) {
      throw new Error(
        'Stripe API key is required. Set it via props.apiKey or STRIPE_SECRET_KEY environment variable.'
      );
    }
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
        resources.push({
          id: construct.node.id,
          path: construct.node.path,
          type: metadata.type,
          properties: metadata.properties,
        });
      }
    }

    return {
      stackId: this.node.id,
      apiVersion: this.apiVersion,
      description: this.description,
      tags: this.tags,
      resources,
    };
  }
}

/** Shape stored by Resource.registerResourceMetadata() */
interface StoredResourceMetadata {
  type: string;
  properties: Record<string, unknown>;
}

export interface ResourceManifest {
  id: string;
  path: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface StackManifest {
  stackId: string;
  apiVersion?: string;
  description?: string;
  tags: Record<string, string>;
  resources: ResourceManifest[];
}
