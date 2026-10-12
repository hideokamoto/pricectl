# Price revision: formal models of the To-be design

Models of the To-be design for price changes discussed for issue #44, written to find
gaps before any implementation.

- `price_revision.als` (Alloy 6): one deploy as a before/after relation. Checks that the
  state the To-be table produces is accepted by Stripe and leaves other prices alone.
- `price_revision.qnt` (Quint): the revision procedure as Stripe API calls, with transient
  failures, best-effort undo and concurrent Dashboard changes.

## Running

```bash
# Alloy 6.2.0 (https://github.com/AlloyTools/org.alloytools.alloy/releases)
java -jar org.alloytools.alloy.dist.jar exec -f -o out price_revision.als

# Quint 0.33.0 with Apalache (bounded model checking)
quint verify --max-steps 14 --invariant failureRestoresUnlessR1R2 price_revision.qnt
```

## Results

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

## Assumptions not verified against Stripe

- An archived price still holds its lookup key (S1).
- A product's default price must belong to that product (S3).
- The API spec allows updating `lookup_key` and `tax_behavior`; the docs say only
  `metadata`, `nickname` and `active` can change after creation.

## Not covered by the models

- The order of calls within one deploy across several prices (Alloy treats deploy as one
  step), e.g. two prices swapping lookup keys.
- Reading the default price and writing it as two calls (Quint treats them as one).
- Several products, and more than one replacement per deploy, in the Quint model.
