# pricectl v0.1.0 Production Readiness Review

**Date**: 2026-02-28
**Reviewers**: QA Team, Security Team, Cloudflare Expert, LINE Expert, Marketing/DX Team, DevOps/SRE Team
**Verdict**: **CONDITIONAL GO** (v0.1.0 としてリリース可)

---

## Summary

| Category | Status | Critical Issues | Notes |
|---|---|---|---|
| Build | PASS | 0 | All 5 packages compile cleanly |
| Tests | PASS (90/90) | 0 | core: 37, constructs: 34, cli: 19 |
| Lint | PASS | 0 | ESLint clean across all packages |
| Security | PASS | 0 | Search query injection protected |
| Cloudflare | N/A | 0 | Not applicable (pure npm CLI tool) |
| LINE | N/A | 0 | Not applicable (no LINE integration) |

---

## 1. QA Team Review

### Test Results

| Package | Suites | Tests | Result |
|---|---|---|---|
| @pricectl/core | 3 | 37 | ALL PASS |
| @pricectl/constructs | 3 | 34 | ALL PASS |
| @pricectl/cli | 1 | 19 | ALL PASS |
| **Total** | **7** | **90** | **ALL PASS** |

### Strengths

- Deployer tests are thorough: create, update, delete, dependency resolution, error handling, search query escaping
- Coupon validation tests (XOR, repeating conditions) are solid
- Construct tree path/findAll recursion tests are comprehensive
- Tests are written in Japanese, serving as readable specifications

### Issues

#### [M-1] `normalizeResource()` duplicated in two files

`diff.ts:149-269` and `stripe-utils.ts:90-191` contain separate implementations of `normalizeResource()` with subtle differences:
- `diff.ts` uses `!= null` for Product but `!== undefined` for Price/Coupon
- `stripe-utils.ts` consistently uses `!== undefined`

**Recommendation**: Consolidate into `stripe-utils.ts`.

#### [M-2] `tax_behavior` gap

`Price` construct does not support `tax_behavior` property, but `deployer.ts:302` compares it in `comparePriceProperties()`. This can cause false negatives in price change detection.

#### [M-6] No E2E tests for CLI commands

The `init`, `synth`, `diff`, `deploy`, and `destroy` commands lack integration/E2E tests. The `--dry-run` flow is untested.

---

## 2. Security Team Review

### Strengths

- Search query injection prevention at `deployer.ts:247` and `stripe-utils.ts:8`
- `.env` in `.gitignore`
- API keys not hardcoded
- Manifest output does not include API keys

### Issues

#### [H-1] Security model documentation needed

User-defined `.ts` files are loaded via `require()` (deploy.ts:43, synth.ts:39, diff.ts:39, destroy.ts:46). This is intentional for IaC tools (same pattern as AWS CDK), but should be documented.

**Recommendation**: Add a Security section to README explaining the execution model.

#### [M-3] `apiKey` as public property

`stack.ts:32` exposes `apiKey` as `public readonly`. While it doesn't leak to manifest files, it could be accidentally logged.

#### [L-1] Stripe API version is dated

`2024-12-18.acacia` is over a year old. Plan for regular updates.

---

## 3. Cloudflare Expert Review

**Verdict: NOT APPLICABLE**

pricectl is a pure npm CLI tool. No Cloudflare Workers, Pages, KV, R2, or any web infrastructure is involved. No `wrangler.toml` exists.

---

## 4. LINE Expert Review

**Verdict: NOT APPLICABLE**

No LINE Messaging API, LINE Login, LIFF, or any LINE-related integration exists in the codebase.

---

## 5. Marketing / DX Team Review

### Strengths

- Comprehensive README with Quick Start, Architecture, CLI Commands, Examples, Comparison Table, Roadmap
- CONTRIBUTING.md is well-structured
- Two working examples (basic-subscription, advanced-pricing)
- `pricectl init` generates a ready-to-use project

### Issues

#### [M-4] npm publish metadata incomplete

Missing in individual package.json files: `repository`, `homepage`, `bugs`, `author`.

#### [M-7] README mentions unimplemented features

Overview mentions "entitlements, meters" but these are not implemented and not in the roadmap.

#### [L-4] No CHANGELOG.md

Should be created for the initial release.

---

## 6. DevOps/SRE Team Review

### CI/CD Pipeline

```
CircleCI: lint + test-node-18 + test-node-20
pnpm 10.29.3 pinned
Jest JUnit reporting enabled
```

### Issues

#### [M-5] Node 22 not tested in CI

Current LTS is Node 22. Should be added to CI matrix.

#### [M-8] lint job missing build step

The lint job doesn't run `pnpm build` first, so TypeScript compilation errors won't be caught by lint alone.

#### [L-5] No automated npm publish pipeline

Package publishing is manual. Consider Changesets or similar.

#### [L-6] No `pnpm audit` in CI

Security dependency auditing not automated.

---

## Issue Priority Summary

### CRITICAL: None

### HIGH

| ID | Issue | Team |
|---|---|---|
| H-1 | Document security model for `require()` user code execution | Security |

### MEDIUM

| ID | Issue | Team |
|---|---|---|
| M-1 | Consolidate duplicate `normalizeResource()` implementations | QA |
| M-2 | Add `tax_behavior` support to Price construct | QA |
| M-3 | Reduce `apiKey` public exposure | Security |
| M-4 | Add npm publish metadata to package.json files | Marketing |
| M-5 | Add Node 22 to CI matrix | DevOps |
| M-6 | Add E2E tests for CLI commands | QA |
| M-7 | Fix README "entitlements, meters" reference | Marketing |
| M-8 | Add build step to CI lint job | DevOps |

### LOW

| ID | Issue | Team |
|---|---|---|
| L-1 | Plan Stripe API version update schedule | Security |
| L-4 | Create CHANGELOG.md | Marketing |
| L-5 | Automate npm publish with Changesets | DevOps |
| L-6 | Add `pnpm audit` to CI | DevOps |

---

## Final Verdict

**GO for v0.1.0 release** with the following conditions:

1. Zero CRITICAL issues confirmed
2. All 90 tests pass, build succeeds, lint is clean
3. No significant security vulnerabilities (search query injection mitigated)
4. H-1 (security model documentation) can be addressed in release notes or README update

This tool follows AWS CDK patterns faithfully and provides solid quality for its well-defined scope of managing Stripe Product/Price/Coupon resources as code.
