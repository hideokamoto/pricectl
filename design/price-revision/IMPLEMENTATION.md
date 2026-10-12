# Price revision: implementation order

Implements decisions 1–9 of `DECISIONS.md` for issue #44. Each slice is test-first
(Red, Green, Refactor as in CLAUDE.md), ends with `pnpm test` and `pnpm lint` green, and is
committed on its own. No migration: pricectl has no users yet, so the state file code is
removed, not kept for compatibility.

| # | Slice | Test level | Decision |
|---|---|---|---|
| 1 | Keys in the manifest: every resource manifest carries `key` = `{stackId}_{logicalId}` (the manifest keeps what the definition says; the planner of slice 5 uses `key` as a price's lookup key when the definition sets none) | unit (core, constructs) | 9 |
| 2 | `synth` checks: two definitions with one lookup key, two default prices for one product, `isDefault` with `active: false` | unit | 2 |
| 3 | `isDefault` on `Price` | unit | 5 |
| 4 | Lock: pure `nextLock(definition, previous)`, `pricectl.lock.json` store, `--frozen-lock` check | unit | 8, 9 |
| 5 | Price planning as a pure function: from the definition and what Stripe returned for the key holder and its `pricectl_previous` chain, the steps (in place, new version, activate, archive, default price, tax rules, key transfer) | unit | 3, 4, 5, 7, 9 |
| 6 | Meters: find the meter in the list of active meters by event name; removals bound to the meter plan saw | unit with a fake Stripe | 8, 9 |
| 7 | `pricectl plan`: read Stripe by key, build the plan, refuse before changing anything | integration (fake Stripe) | 1 |
| 8 | `deploy` applies the plan it built; `destroy` uses the same lookup; remove `StateManager`, orphan search and `deploy --dry-run` | integration | 1, 8 |
| 9 | Lookup-key change is a removal plus an addition, with the rename warning | unit, integration | 6, 9 |
| 10 | E2E against Stripe test mode: default price replacement, destroy, key change, meter | e2e (`test/e2e/`) | all |

Slices 1–5 add behavior without touching the existing deployer, so the suite stays green
while the new parts take shape. Slices 7–8 switch the deployer over and delete the old paths.
