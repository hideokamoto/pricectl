# @pricectl/core

Core IaC framework for [pricectl](https://github.com/hideokamoto/pricectl) — a kubectl-style tool for managing Stripe pricing resources with TypeScript.

## Installation

```bash
npm install @pricectl/core
# or
pnpm add @pricectl/core
```

## Overview

`@pricectl/core` provides the foundational building blocks for defining Stripe infrastructure as code. Inspired by [AWS CDK](https://aws.amazon.com/cdk/), it exposes three base classes:

| Class | Description |
|-------|-------------|
| `Construct` | Base class for all pricectl constructs |
| `Stack` | Container that groups resources for deployment |
| `Resource` | Abstract base class for Stripe resource constructs |

## Usage

### Stack

A `Stack` is the root container for your Stripe resources. It holds configuration such as the Stripe API key and tags.

```typescript
import { Stack } from '@pricectl/core';

const stack = new Stack(undefined, 'MyStack', {
  description: 'My Stripe pricing infrastructure',
  // apiKey is read from STRIPE_SECRET_KEY env var by default
});
```

#### StackProps

| Property | Type | Description |
|----------|------|-------------|
| `apiKey` | `string` | Stripe secret key (falls back to `STRIPE_SECRET_KEY` env var) |
| `description` | `string` | Human-readable description of the stack |
| `tags` | `Record<string, string>` | Tags applied to all resources in the stack |

#### `stack.synth()`

Synthesizes the stack into a `StackManifest` — a plain JSON-serialisable object describing all resources and their properties.

```typescript
const manifest = stack.synth();
console.log(JSON.stringify(manifest, null, 2));
```

### Construct

`Construct` is the base class for every node in the construct tree. You rarely instantiate it directly; instead, use higher-level classes from `@pricectl/constructs`.

```typescript
import { Construct } from '@pricectl/core';

class MyConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
  }
}
```

#### ConstructNode

Each `Construct` exposes a `node` property of type `ConstructNode` with these members:

| Member | Type | Description |
|--------|------|-------------|
| `id` | `string` | Logical ID within its scope |
| `path` | `string` | Full path from the root (e.g. `MyStack/MyProduct`) |
| `scope` | `Construct \| undefined` | Parent construct |
| `children` | `Construct[]` | Direct child constructs |
| `findAll()` | `Construct[]` | All descendants including self |

### Resource

`Resource` is the abstract base class for Stripe resources. Extend it when building custom resource constructs.

```typescript
import { Construct, Resource, ResourceProps } from '@pricectl/core';

interface MyResourceProps extends ResourceProps {
  readonly name: string;
}

class MyResource extends Resource {
  constructor(scope: Construct, id: string, props: MyResourceProps) {
    super(scope, id, props);
    // … set properties …
    this.registerResourceMetadata(); // must be called last
  }

  protected get resourceType(): string {
    return 'Stripe::MyResource';
  }

  protected synthesizeProperties(): object {
    return { name: '…' };
  }
}
```

> **Important:** Always call `this.registerResourceMetadata()` at the **end** of your constructor, after all properties are initialized.

#### ResourceProps

| Property | Type | Description |
|----------|------|-------------|
| `physicalId` | `string` | Existing Stripe resource ID (for importing resources) |

## API Reference

### `Stack`

```typescript
new Stack(scope: Construct | undefined, id: string, props?: StackProps)
```

- `synth(): StackManifest` — synthesize the stack into a manifest

### `Construct`

```typescript
new Construct(scope: Construct | undefined, id: string)
```

- `node: ConstructNode` — access the construct's node metadata

### `Resource` (abstract)

```typescript
new Resource(scope: Construct, id: string, props?: ResourceProps)
```

- `physicalId?: string` — Stripe physical ID
- `stack: Stack` — the owning Stack
- `registerResourceMetadata(): void` — register synthesized properties (call at end of constructor)
- `get resourceType(): string` — abstract, return the Stripe resource type string
- `synthesizeProperties(): any` — abstract, return Stripe API create params

## License

MIT
