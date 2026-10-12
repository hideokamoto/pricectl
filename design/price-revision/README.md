# Price revision: formal models of the To-be design

Models of the design for price changes discussed for issue #44, written to find gaps
before any implementation. `DECISIONS.md` records the decisions and the Stripe behavior
verified in test mode (`verify_stripe.py`).

- v1 (`price_revision.als`, `price_revision.qnt`): the first To-be design; found gaps G1-G8 and R1-R3.
- v2 (`price_revision_v2.als`, `price_revision_v2.qnt`): decisions 1-7 with a state file; found G9.
- v3 (`price_revision_v3.als`, `meter_lock_v3.qnt`): the current design, without a state file (decision 8).

## v3 results

`price_revision_v3.als` (Alloy, scope 4, 6 prices), ownership from metadata only:

| Check | Result |
|---|---|
| StripeAcceptsResult, TaxTransitionsLegal, ForeignPricesUntouched, NewPriceOnlyWhenNeeded, Realizes, OneVersionOnSale, PlanRefusesOnlyForeignWithoutFlag | hold |
| runs: reuse an archived version, move a followed default, unset a removed default, key from a removed price, key from outside with the flag, two versions on sale collapse to one | instance found for each |

`meter_lock_v3.qnt` (Quint, Apalache, 18 steps), meters and `pricectl.lock.json` across
commits (with and without the lock), CI deploys with failures (including a create that
fails after Stripe created the meter), people dropping lock entries, and Dashboard changes:

| Invariant | Result |
|---|---|
| oneActiveMeter | holds |
| noFloatingMeter (an active meter pricectl created is defined or in the lock, unless a person released it) | holds |
| foreignDeactivatedOnlyWhenClaimed (a Dashboard meter is deactivated only if it was active while the lock listed its event name) | holds |
| cleanDeployConverges (a deploy without failures or outside changes during it ends as defined) | holds |
| witnesses: CI refuses an out-of-date lock, a removed meter is added again, a Dashboard meter is taken over, a meter is adopted | reachable |

`meter_lock_v3b.qnt` (Quint), the same with two event names, a deploy that keeps using the
commit it started from while new commits land, and two deploys that may run at the same
time. Removals deactivate only the meters plan saw. Apalache stopped at the step shown
(about an hour each); simulation 20,000 samples of 40 steps:

| Invariant | Apalache | Simulation |
|---|---|---|
| oneActivePerName | holds up to 15 steps | no violation |
| serialNoFloating | holds up to 13 steps | no violation |
| serialForeignOnlyWhenClaimed | holds up to 14 steps | no violation |
| serialConverges | holds up to 15 steps | no violation |
| concurrentNoFloating | holds up to 14 steps | no violation |
| concurrentForeignOnlyWhenClaimed | holds up to 13 steps | no violation |
| concurrentConverges | counterexample: a deploy of an older commit creates a meter after a newer deploy planned its removal; the meter stays tracked as `removing` | |
| soloDeployRecovers (after overlapping deploys, a later deploy of the latest commit that runs alone ends as defined) | holds up to 12 steps | no violation |
| witnesses: two deploys at once, both names managed, a lone deploy finishing after an overlap | reachable | |

Before removals were bound to what plan saw, `serialForeignOnlyWhenClaimed` had a
counterexample: a deploy still running from an older commit deactivated a meter created in
the Dashboard after a person had released the event name.

## v2 results

Alloy, scope 4 (6 prices); the fixed-rule checks and the diagnosis also at scope 5 (8 prices):

| Check | Result |
|---|---|
| StripeAcceptsResult, TaxTransitionsLegal, ForeignPricesUntouched, NewPriceOnlyWhenNeeded, Realizes, NoStrayVersionOnSale | hold |
| PlanRefusesOnlyRealConflicts | counterexample: G9 (key held by an unused version of another definition); no other cause (`PlanRefusesExplainedByH1` holds) |
| `*Ext` checks (rule for G9, now decision 4 in DECISIONS.md) | all hold; plan then refuses only for a key held outside the stack without `transferLookupKey` |
| 11 runs of the decided behaviors (default moved, default unset, declared default, stray reused/archived, key from orphan/foreign/other definition, tax in place/new version, inactive default) | instance found for each, so the checks are not vacuous |

Quint (`price_revision_v2.qnt`), deploys repeated after failures:

| Invariant | Apalache, 2 deploys, 22 steps | Simulation, 3 deploys, 30000 samples |
|---|---|---|
| defaultIsActive | holds | no violation |
| atMostOneNewVersion (retries reuse the stray) | holds | no violation |
| cleanDeployConverges (a deploy without errors or Dashboard changes ends as defined) | holds | no violation |
| rejectedOnlyOnInterference | holds | no violation |
| witnesses (success, recovery after failure, stray reuse, Dashboard race) | reachable (3 deploys, 24 steps) | |

## v1 results

- `price_revision.als` (Alloy 6): one deploy as a before/after relation. Checks that the
  state the To-be table produces is accepted by Stripe and leaves other prices alone.
- `price_revision.qnt` (Quint): the revision procedure as Stripe API calls, with transient
  failures, best-effort undo and concurrent Dashboard changes.

Alloy, scope 4 (6 prices); the `*Explained*` checks and `ClassificationTotal` were also run
at scope 5 (8 prices) with the same outcome.

| Check | Result | Meaning |
|---|---|---|
| ClassificationTotal | holds | every definition falls into exactly one To-be case |
| StripeAcceptsResult | counterexample | causes G1–G5 |
| TaxTransitionsLegal | counterexample | cause G6 |
| ForeignPricesUntouched | counterexample | cause G7 |
| NewPriceOnlyWhenNeeded | counterexample | cause G8 |
| *ExplainedBy* (4 checks) | hold | no other cause within the scope |
| runs G1–G8 | instance found | each cause alone breaks the property |

Quint, Apalache, 14 steps:

| Invariant | Result |
|---|---|
| defaultIsActive, successResult | hold |
| atMostOneActiveAtEnd, failureRestores | violated; hold once R1 and R2 are excluded |
| failsOnlyOnTransientOrRace | violated; holds once R3 is excluded |
| noR1Break, noR2Break, noR3Break | violated (each cause alone breaks a property) |

## Running

```bash
# Alloy 6.2.0 (https://github.com/AlloyTools/org.alloytools.alloy/releases)
java -jar org.alloytools.alloy.dist.jar exec -f -o out price_revision_v3.als

# Quint 0.33.0 with Apalache (bounded model checking); set MAX_RUNS to 2 for the 2-deploy check
quint verify --max-steps 22 --invariant cleanDeployConverges price_revision_v2.qnt
quint run --backend typescript --max-samples 30000 --max-steps 45 --invariant cleanDeployConverges price_revision_v2.qnt

quint verify --max-steps 18 --invariant noFloatingMeter meter_lock_v3.qnt

# Stripe test mode (key read from a file, never committed)
python3 verify_stripe.py path/to/key-file created.json
```

## Assumptions

S1-S4 were verified in test mode after v1 (see DECISIONS.md). S5 (fields Stripe cannot
change) comes from the API spec.

## Not covered by the models

- The order of calls within one deploy across several prices (Alloy treats deploy as one
  step), e.g. two prices swapping lookup keys.
- Reading the default price and writing it as two calls (Quint treats them as one).
- Several products, and more than one replacement per deploy, in the Quint models.
- Declared default prices (`isDefault`) in Quint; only Alloy covers them.
- Several event names, and deploys of one stack running at the same time, in `meter_lock_v3.qnt`
  (deploys are assumed serialized).
- Listing time was measured, not modeled: 10,083 prices take 41.9-45.6 s in test mode
  (`measure_listing.py`, see DECISIONS.md).
- Exhaustive checking of three or more deploys in a row (simulation only).
