import { Construct } from '../construct';
import { Resource } from '../resource';

export class TestResource extends Resource {
  constructor(
    scope: Construct,
    id: string,
    private readonly props: { type: string; properties: Record<string, unknown>; physicalId?: string }
  ) {
    super(scope, id, { physicalId: props.physicalId });
    this.registerResourceMetadata();
  }

  protected get resourceType(): string {
    return this.props.type;
  }

  protected synthesizeProperties(): Record<string, unknown> {
    return this.props.properties;
  }
}
