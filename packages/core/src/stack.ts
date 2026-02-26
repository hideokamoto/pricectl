import { Construct } from './construct';
import { STRIPE_API_KEY_MISSING_ERROR } from './errors';

export interface StackProps {
  /**
   * Stripe API key (secret key)
   */
  readonly apiKey?: string;

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
  public readonly description?: string;
  public readonly tags: Record<string, string>;

  constructor(scope: Construct | undefined, id: string, props: StackProps = {}) {
    super(scope, id);

    this.apiKey = props.apiKey || process.env.STRIPE_SECRET_KEY;
    this.description = props.description;
    this.tags = props.tags || {};

    if (!this.apiKey) {
      throw new Error(STRIPE_API_KEY_MISSING_ERROR);
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

      const metadata = construct.node.getMetadata('resource');
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
      description: this.description,
      tags: this.tags,
      resources,
    };
  }
}

export interface ResourceManifest {
  id: string;
  path: string;
  type: string;
  properties: any;
}

export interface StackManifest {
  stackId: string;
  description?: string;
  tags: Record<string, string>;
  resources: ResourceManifest[];
}
