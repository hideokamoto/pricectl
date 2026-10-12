# Price revision: implementation order

Implements decisions 1–9 of `DECISIONS.md` for issue #44. Each slice is test-first
(Red, Green, Refactor as in CLAUDE.md), ends with `pnpm test` and `pnpm lint` green, and is
committed on its own. No migration: pricectl has no users yet, so the state file code is
removed, not kept for compatibility.

| # | Slice | Test level | Decision | Status |
|---|---|---|---|---|
| 1 | Keys in the manifest: every resource manifest carries `key` = `{stackId}_{logicalId}` (the manifest keeps what the definition says; the planner of slice 5 uses `key` as a price's lookup key when the definition sets none) | unit (core, constructs) | 9 | done |
| 2 | `synth` checks: two definitions with one lookup key, two default prices for one product, `isDefault` with `active: false` | unit | 2 | done |
| 3 | `isDefault` on `Price` | unit | 5 | done |
| 4 | Lock: pure `nextLock(definition, previous)`, `pricectl.lock.json` store, `--frozen-lock` check | unit | 8, 9 | done |
| 5 | Price planning as a pure function: from the definition and what Stripe returned for the key holder and its `pricectl_previous` chain, the steps (in place, new version, activate, archive, default price, tax rules, key transfer) | unit | 3, 4, 5, 7, 9 | done |
| 6 | Meters: find the meter in the list of active meters by event name; removals bound to the meter plan saw | unit with a fake Stripe | 8, 9 | done |
| 7 | `pricectl plan`: read Stripe by key, build the plan, refuse before changing anything | integration (fake Stripe) | 1 | done |
| 8 | `deploy` applies the plan it built; `destroy` uses the same lookup; remove `StateManager`, orphan search and `deploy --dry-run` | integration | 1, 8 | done |
| 9 | Lookup-key change is a removal plus an addition, with the rename warning | unit, integration | 6, 9 | done |
| 10 | E2E against Stripe test mode: default price replacement, destroy, key change, meter | e2e (`test/e2e/`) | all | done (`pnpm test:e2e`) |

Slices 1–5 add behavior without touching the existing deployer, so the suite stays green
while the new parts take shape. Slices 7–8 switch the deployer over and delete the old paths.

## What changed while implementing

Decisions 1-9 stand. These were settled in code and are recorded here:

- The manifest carries `key`; the price planner applies it as the lookup key when the definition
  sets none. The manifest keeps what the definition says.
- `plan` and `deploy` update `pricectl.lock.json` (as `synth` does); `--frozen-lock` only checks.
- `destroy` removes everything the lock claims for the stack; when that succeeds the stack's
  entries are dropped from the lock (running destroy is a person releasing the keys). When
  something fails, the keys stay `removing` and the next destroy or deploy finishes the job.
- A resource adopted with `physicalId` is not claimed in the lock and is never removed by pricectl.
- A removed product, feature or meter that a defined resource still names by its Stripe ID is
  kept: it is no longer the stack's to remove.
- An archived price keeps its lookup key (observed in `test/e2e`). After a lookup key change the
  old price is off sale and still holds the old key; defining that key again reuses it in place.
- Following `pricectl_previous` costs one retrieve per version of a slot, so a slot with many
  past versions is slower to plan. Nothing else in a plan grows with the account.
- A key in the lock under a resource type this pricectl does not know is ignored.
- Ten end-to-end tests ran against Stripe test mode: default price replacement and destroy,
  tax behavior in place and as a new version, feature/coupon/meter lifecycle, a changed lookup
  key, a key held outside the stack (refused, then taken with `transferLookupKey`), and the
  `plan`, `deploy` and `destroy` commands themselves (`test/e2e/`).
