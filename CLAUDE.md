# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Project Overview

pricectl is an Infrastructure as Code (IaC) tool for managing Stripe pricing resources (products, prices, coupons) using TypeScript. It's a kubectl-style CLI tool that allows declarative definition and deployment of Stripe resources.

## Repository Structure

This is a pnpm monorepo with three packages:

```
pricectl/
├── packages/
│   ├── core/          # Base IaC framework (Construct, Stack, Resource classes)
│   ├── constructs/    # Stripe resource implementations (Product, Price, Coupon)
│   └── cli/           # CLI commands (init, synth, diff, deploy, destroy)
├── examples/
│   ├── basic-subscription/
│   └── advanced-pricing/
├── pnpm-workspace.yaml
└── package.json
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Lint all packages
pnpm lint

# Clean build artifacts
pnpm clean
```

## Requirements

- Node.js >= 18.0.0
- pnpm >= 9.0.0

## Architecture Notes

- **`@pricectl/core`**: Provides `Construct`, `Stack`, and `Resource` base classes. Similar to AWS CDK's core module.
- **`@pricectl/constructs`**: Implements Stripe-specific resources. Each resource extends `Resource` from core.
- **`@pricectl/cli`**: Uses the deployer engine in `src/engine/deployer.ts` to interact with the Stripe API.

## Adding a New Stripe Resource

1. Create the construct in `packages/constructs/src/<resource>.ts` extending `Resource`
2. Export it from `packages/constructs/src/index.ts`
3. Add deployment logic in `packages/cli/src/engine/deployer.ts`
4. Add tests alongside the implementation
5. Update documentation

## Code Style

- TypeScript for all code
- Follow existing conventions (ESLint + Prettier configured)
- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`
- Add JSDoc comments for public APIs
