/**
 * Base class for all pricectl constructs.
 * Inspired by AWS CDK's Construct class.
 */
export interface IConstruct {
  readonly node: ConstructNode;
}

export class ConstructNode {
  private _children: Construct[] = [];
  private _metadata: Record<string, any> = {};

  constructor(
    private readonly host: Construct,
    private readonly _id: string,
    private readonly _scope?: Construct
  ) {}

  public get id(): string {
    return this._id;
  }

  public get scope(): Construct | undefined {
    return this._scope;
  }

  public get children(): Construct[] {
    return [...this._children];
  }

  public get path(): string {
    const parts: string[] = [];
    let current: Construct | undefined = this.host;

    while (current) {
      if (current.node.id) {
        parts.unshift(current.node.id);
      }
      current = current.node.scope;
    }

    return parts.join('/');
  }

  public addChild(child: Construct): void {
    this._children.push(child);
  }

  public addMetadata(key: string, value: any): void {
    this._metadata[key] = value;
  }

  public getMetadata(key: string): any {
    return this._metadata[key];
  }

  public findAll(): Construct[] {
    const result: Construct[] = [this.host];
    for (const child of this._children) {
      result.push(...child.node.findAll());
    }
    return result;
  }
}

export class Construct implements IConstruct {
  public readonly node: ConstructNode;

  constructor(scope: Construct | undefined, id: string) {
    this.node = new ConstructNode(this, id, scope);

    if (scope) {
      scope.node.addChild(this);
    }
  }

  public toString(): string {
    return this.node.path;
  }
}
