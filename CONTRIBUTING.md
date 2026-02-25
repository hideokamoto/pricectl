# Contributing to pricectl

Thank you for your interest in contributing to pricectl! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- A Stripe account (for testing)

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/pricectl.git
   cd pricectl
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Build all packages:
   ```bash
   pnpm build
   ```

## Development Workflow

### Project Structure

```
pricectl/
├── packages/
│   ├── core/          # Core IaC framework
│   ├── constructs/    # Stripe pricing constructs
│   └── cli/           # Command-line interface
└── examples/          # Example projects
```

### Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the appropriate package

3. Build the project:
   ```bash
   pnpm build
   ```

4. Test your changes:
   ```bash
   pnpm test
   ```

5. Lint your code:
   ```bash
   pnpm lint
   ```

### Adding a New Stripe Resource

To add support for a new Stripe resource:

1. Create a new file in `packages/constructs/src/`:
   ```typescript
   // packages/constructs/src/entitlement.ts
   import { Construct, Resource, ResourceProps } from '@pricectl/core';
   import type Stripe from 'stripe';

   export interface EntitlementProps extends ResourceProps {
     readonly feature: string;
     readonly name: string;
   }

   export class Entitlement extends Resource {
     // Implementation...
   }
   ```

2. Export it from `packages/constructs/src/index.ts`:
   ```typescript
   export * from './entitlement';
   ```

3. Add deployment logic in `packages/cli/src/engine/deployer.ts`

4. Add tests

5. Update documentation

### Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/core
pnpm test

# Run tests in watch mode
pnpm test --watch
```

### Running Examples

```bash
cd examples/basic-subscription
export STRIPE_SECRET_KEY=sk_test_...
pnpm install
pnpm build
pnpm deploy
```

## Pull Request Process

1. Update documentation for any user-facing changes
2. Add tests for new functionality
3. Ensure all tests pass
4. Update the README.md if needed
5. Submit a pull request with a clear description of changes

### PR Title Format

Use conventional commits format:

- `feat: add webhook support`
- `fix: handle empty price lists`
- `docs: update README examples`
- `chore: update dependencies`
- `test: add tests for Product class`

## Code Style

- Use TypeScript for all new code
- Follow existing code conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Adding Examples

Examples help users understand how to use pricectl:

1. Create a new directory in `examples/`
2. Add a complete working example
3. Include a detailed README.md
4. Add it to the main README.md

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to pricectl!
