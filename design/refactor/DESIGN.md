# `pricectl refactor`: design after the key-based lookup

Design for issue #51, rewritten for the architecture of #49 (decisions 8 and 9 of
`design/price-revision/DECISIONS.md`). Nothing here is implemented.

The original proposal assumed logical IDs are tracked in metadata (`pricectl_id`,
`pricectl_path`) **and** in a state file, so a rename would update both. Neither holds now:
there is no state file, `pricectl_path` is not written by any code, and `pricectl_id` is
written but never read. What identifies an object is its **key**. This document works out
what a rename means under that rule, type by type.

Evidence is marked:

- **[code]**: read in the source at the path given.
- **[fake]**: observed by running the current planner against `FakeStripe`
  (`packages/cli/src/__tests__/helpers/fake-stripe.ts`): deploy a definition with logical ID
  `Old`, then deploy it with `New` and the lock the first deploy produced. The probe was a
  throwaway test and is not committed; each scenario below says what to build to reproduce it.
- **[test mode]**: in `design/price-revision/verify_*.result.txt` or `test/e2e/`.
- **[docs]**: Stripe API reference (docs.stripe.com, read 2026-10-13).
- **Unverified**: needs a test-mode check before it is relied on.

## 1. What identifies a resource now

`Resource.key` is `${stack.node.id}_${this.node.id}`: the stack ID and the construct's own ID,
**not its path** (`packages/core/src/resource.ts`, `key` getter). The key pricectl claims in
the lock (`claimedKey`, `packages/cli/src/engine/lock.ts`) and looks objects up by
(`readObservations`, `packages/cli/src/engine/read-stripe.ts`) is:

| Type | Claimed key | Lookup | Depends on the logical ID? |
|---|---|---|---|
| Product | `resource.key` (= Stripe ID) | `products.retrieve(key)` | yes |
| Coupon | `resource.key` (= Stripe ID) | `coupons.retrieve(key)` | yes |
| Price, no `lookupKey` | `resource.key` (= lookup key) | `prices.list({ lookup_keys })` | yes |
| Price, with `lookupKey` | the definition's `lookup_key` | same | no |
| Entitlement feature | the definition's `lookup_key` (required prop, `packages/constructs/src/entitlement.ts`) | `features.list({ lookup_key, archived: false })` | no |
| Billing meter | `event_name` | active meters, matched by event name | no |

A resource with `physicalId` claims nothing (`claimedKey` returns undefined) [code].

Two consequences:

- **Moving a construct into another scope does not change its key**, because the key uses the
  construct ID, not the path. The CDK problem that `cdk refactor` mainly addresses (path-based
  logical IDs changing when constructs are moved) does not arise. What remains is a **change of
  the construct ID**, which the stack-wide uniqueness rule (`Stack.registerResourceId`) forces
  when a construct that creates resources is instantiated twice (the example in #51:
  `Monthly` becoming `ProMonthly` and `BasicMonthly`).
- **Metadata does not identify anything.** `pricectl_stack` is read (ownership checks in
  `build-plan.ts`, `read-stripe.ts`, `price-plan.ts`) and `pricectl_previous` is read (version
  chain, `read-stripe.ts`). `pricectl_id` is only written (`product-plan.ts`, `coupon-plan.ts`,
  `feature-plan.ts`, `price-plan.ts`) and never read; `IMPLEMENTATION.md` lists "which slot
  (`pricectl_id`) it belongs to is not checked" as a known limit. `pricectl_path` appears
  nowhere in `packages/` [code].

So: **a rename keeps the Stripe object if and only if the key stays the same, or the key can be
moved to the same object in Stripe.**

## 2. What happens today, per type

Observed with the current planner [fake]. Each row: deploy with ID `Old`, then deploy with `New`.

| Scenario | Lock after the second deploy | Plan | Result |
|---|---|---|---|
| Price without `lookupKey` | `S_Old: removing`, `S_New: managed` | `New` create, `S_Old` remove (archive) | replaced; rename warning |
| Price with `lookupKey: 'k'` | `k: managed` (unchanged) | `New` unchanged | kept; `pricectl_id` stays `Old` |
| Product (its price has `lookupKey`) | `S_Old: removing`, `S_New: managed` | product `New` create; price create + archive; `S_Old` remove (archiveProduct) | product **and its prices** replaced |
| Coupon | `S_Old: removing`, `S_New: managed` | `New` create, `S_Old` remove (deleteCoupon) | replaced |
| Feature (`lookupKey: 'f'`, attached to a product) | `f: managed` (unchanged) | feature and product unchanged | kept; `pricectl_id` stays `Old` |
| Meter (`eventName: 'ev'`, used by a price) | `ev: managed` (unchanged) | meter and price unchanged | kept |

The "kept" rows are kept because nothing in the plan looks at the logical ID once the object is
found: `ownershipTags` returns nothing when `pricectl_stack` already matches
(`packages/cli/src/engine/metadata.ts`), and price in-place changes compare user metadata only
(`userMetadata` strips `pricectl_*`, `price-plan.ts` `inPlaceChanges`). The README sentence
"Changing a logical ID or a lookup key therefore replaces the object" (`README.md`, "How
resources are found") is therefore only true for products, coupons and prices without
`lookupKey`.

The second row also shows a rename that already works without any command: a price renamed
from `Old` to `New` **with `lookupKey: 'S_Old'`** (the old derived key, written explicitly) is
`unchanged`, and the lock entry stays `S_Old: managed` [fake].

## 3. Per type: can a rename keep the object?

### 3.1 Price without an explicit `lookupKey`: possible

The lookup key derives from the logical ID, so it changes from `{stackId}_{Old}` to
`{stackId}_{New}`. Two ways to keep the price:

**(a) Pin the key in the definition.** Set `lookupKey: '{stackId}_{Old}'` on the renamed
price. Works today, no command needed [fake, last paragraph of section 2]. The price, its ID, its
lookup key and its version chain stay. Cost: the key keeps the old name.

**(b) Move the key on the same price.** Update the holder of `{stackId}_{Old}` in place:
`prices.update(holder, { lookup_key: '{stackId}_{New}' })`.

- Updating `lookup_key` in place works [test mode: `verify_stripe.result.txt` T3, "update X
  lookup_key k1->k2 in place", HTTP 200]. The price update endpoint lists `lookup_key` and
  `transfer_lookup_key` [docs: /api/prices/update].
- When the new key is held by another price, the update is rejected without
  `transfer_lookup_key` and succeeds with it; the previous holder loses the key [test mode: T3].
  The rule of decision 4 applies: take it from a price of the stack, refuse it from a price
  outside the stack unless the definition sets `transferLookupKey`.
- The price keeps its ID, so subscriptions, the product's `default_price` and the
  `pricectl_previous` chain (metadata on the holder, followed by `readVersions`) are untouched
  [code].
- After the move, a plan with the new definition is `unchanged`, and the old key, now
  `removing` with no holder, produces no step [fake: holder's key changed to `S_New` by hand,
  then `buildPlan` with the new definition and lock: `New` unchanged, no removal item].
- `pricectl_id` can be updated in the same call; metadata is updatable on prices [docs].
- **Unverified, needs a test-mode check:**
  - moving the key of an **archived** holder (a slot defined with `active: false`, or a holder
    archived outside pricectl). T3 only moved the key of an active price.
  - `lookup_key` and `metadata` in **one** update request (each was verified alone).

What (b) does not keep: **the lookup key string.** Application code that looks the price up
by `{stackId}_{Old}` stops finding it, exactly as with the current replacement. Only (a)
keeps the key. Decision 9 states "Stripe can move a key in place; that optimization is not
used"; (b) would be the one place that uses it.

### 3.2 Price with an explicit `lookupKey`: nothing to do

The key does not depend on the logical ID, so a rename is already a no-op in Stripe and in the
lock [fake]. The only trace of the old name is `pricectl_id`, which nothing reads. A refactor
command may rewrite it (cosmetic) or leave it.

If the rename also changes the price's **product** (the price refers to a renamed product),
the price cannot be kept: the price update endpoint has no `product` parameter [docs], and
`arePriceTermsEqual` compares the product (`packages/cli/src/engine/price-comparison.ts`), so
the planner creates a new version. See 3.3.

### 3.3 Product: impossible without pinning the ID

- The key is the Stripe product ID. The product update endpoint has no `id` parameter [docs:
  /api/products/update]. A second product cannot be created with an ID in use [test mode:
  `verify_keys.result.txt` K1, `resource_already_exists`]. So `{stackId}_{New}` cannot be the
  existing object. **A rename that keeps the derived ID scheme cannot keep the product.**
- Renaming a product also replaces **every price on it**, even prices with an explicit
  `lookupKey`: a `Price` refers to its product by logical ID
  (`packages/constructs/src/price.ts`, `product.physicalId || product.node.id`), the new
  logical ID resolves to the new product ID, and a price cannot change product [fake: row
  "Product"; docs].
- Ways to keep it:
  - **Adopt the old ID**: `new Product(stack, 'New', { physicalId: '{stackId}_{Old}' })`. The
    plan is `unchanged` for the product and its prices [fake]. Side effects observed [fake]:
    the lock keeps `{stackId}_{Old}: removing` (adopted resources claim nothing), the removal is
    skipped only because a defined resource references the ID (`referencedStripeIds`,
    `build-plan.ts`), and `destroy` still archives the product through that `removing` entry
    (if a person drops the entry, destroy no longer touches the product). This is a workaround
    with surprising lifecycle semantics, not a design.
  - **A way to pin the key in the definition** (for example a construct prop that overrides
    `key`, like `overrideLogicalId` in CDK). Does not exist; it would be a change to
    `@pricectl/core`. Open question 2.
- A refactor command can only **refuse** a product rename and explain these options.

### 3.4 Coupon: impossible without pinning the ID

- The key is the coupon ID. The coupon update endpoint accepts only `currency_options`,
  `metadata` and `name`; "Other coupon details ... are, by design, not editable" [docs:
  /api/coupons/update]. Duplicate IDs are rejected [test mode: K5]. **A rename cannot keep the
  coupon.**
- Deleting the old coupon "does not affect any customers who have already applied the coupon;
  it means that new customers can't redeem the coupon" [docs: /api/coupons/delete]. Anything
  that refers to the old coupon ID (promotion codes, application code, checkout links) is not
  managed by pricectl and would break; unverified what happens to promotion codes of a deleted
  coupon.
- `physicalId` is **not** a workaround for coupons in the current code: `readObservations`
  retrieves coupons by `resource.key` even when `physicalId` is set (`read-stripe.ts`), and
  `planCouponResource` does not look at `physicalId`. With `physicalId: '{stackId}_{Old}'` on a
  coupon `New`, the plan creates `{stackId}_{New}` and deletes `{stackId}_{Old}` [fake]. This
  looks like a gap of its own, separate from #51 (open question 6).
- A refactor command can only **refuse** a coupon rename.

### 3.5 Entitlement feature: nothing to do

The key is the definition's `lookupKey`, which the construct requires. A rename keeps the
feature and its product attachments [fake]: `resolveFeatureRef` resolves the product's
feature references through the feature found by lookup key (`refs.ts`). The feature update
endpoint accepts `active`, `metadata` and `name`, not `lookup_key` [docs:
/api/entitlements/feature/updates], so a lookup key change remains a replacement, as decision 9
says. Only `pricectl_id` is stale (cosmetic).

### 3.6 Billing meter: nothing to do

The key is `event_name`. A rename keeps the meter and the prices on it [fake]:
`resolveMeterRef` finds the meter by event name among active meters (`refs.ts`). Meters have
no metadata [test mode: `verify_stripe.result.txt` T6], so there is nothing to rewrite. The
meter update endpoint accepts only `display_name` [docs: /api/billing/meter/update].

### Summary

| Type | Rename keeps the object? | What has to change | Status |
|---|---|---|---|
| Price, derived key | yes, two ways: pin the old key in the definition, or move the key in Stripe | (a) definition only; (b) holder's `lookup_key` (+ `pricectl_id`), lock | (a) works today [fake]; (b) verified for an active price [test mode], unverified for an archived one |
| Price, explicit key | already kept | nothing (`pricectl_id` cosmetic) | works today [fake] |
| Price whose product is renamed | no | new version on the new product | impossible: price product is not updatable [docs] |
| Product | no, unless the old ID is pinned | needs a key override that does not exist; `physicalId` adoption works with side effects | impossible as a rename [docs, test mode] |
| Coupon | no | needs a key override that does not exist; `physicalId` does not help today | impossible as a rename [docs, test mode] |
| Entitlement feature | already kept | nothing (`pricectl_id` cosmetic) | works today [fake] |
| Billing meter | already kept | nothing | works today [fake] |

## 4. Proposed command

The only case where a command adds something the definition cannot already express is 3.1(b):
moving a derived price key to the same price. Everything else is either already a no-op or
impossible. Open question 1 asks whether that is worth a command or whether documentation plus
a better `plan` message (pin the key) is enough. If the command is built, this is the proposal.

### 4.1 Detection

`pricectl refactor [--app] [--mapping <file>] [--dry-run] [--force]`

1. Synthesize; compute `next = nextLock(definition, current lock)` as `plan` does.
2. Read Stripe with `readObservations` (`read-stripe.ts`), unchanged: it already reads the
   holders of every defined key and every `removing` price key.
3. Candidates, per type:
   - **Price**: a `removing` key `K_old` whose holder `H` belongs to the stack
     (`pricectl_stack`), and a defined price `D` without its own `lookupKey` whose key `K_new`
     is new in the lock and has no holder, such that `H` can be reused for `D` without a new
     version (`isReusable` in `price-plan.ts`: same terms, compatible `tax_behavior`) and
     without any in-place change (rename only).
   - **Product, coupon**: a `removing` key and a new key of the same type whose definitions
     would otherwise be equal. These are reported as **impossible** with the options of 3.3 and
     3.4, and the command refuses.
   - **Feature, meter, price with an explicit key**: no key changed, so nothing is detected
     and nothing is needed. Optionally (open question 4) `pricectl_id` is rewritten.
4. **Ambiguity**: when one `K_old` matches several `D` or one `D` matches several `K_old`
   (identical prices on one product renamed at once), the command refuses unless a mapping
   file names the pairs. Mapping by key, because the lock holds keys and not logical IDs:

   ```json
   { "stacks": { "Shop": { "Stripe::Price": { "Shop_Monthly": "ProMonthly" } } } }
   ```

   (old key -> new logical ID). Like the CDK override file, it is only consulted for
   ambiguous matches; a mapping that contradicts an unambiguous match is an error.

### 4.2 Refusing mixed changes

As in `cdk refactor`, which "will be rejected" when "it detects any resource additions,
deletions, or modifications" (AWS CDK guide, Refactoring). Rule: build the plan that `deploy`
would build **after** the moves, by composing it (`composePlan`, `build-plan.ts`) from the
observations with each moved holder's `lookup_key` replaced. If that plan has any item that is
not `unchanged`, any removal step, or any refusal, the command changes nothing and lists them
("deploy these changes first, then refactor", or the other way round). This reuses the planner
instead of a second notion of "equal".

### 4.3 Applying

Per matched price, one call: `prices.update(H.id, { lookup_key: K_new, metadata: {
pricectl_id: New } })`, with `transfer_lookup_key: true` only when `K_new` is held by a price
of the stack (cannot happen when step 3 requires `K_new` to have no holder; kept for the rule
of decision 4 if that requirement is relaxed). The steps name the price IDs the read found,
as `deploy` does (decision 8, "deploy applies the plan it showed").

### 4.4 Lock

Before the command: after `synth`/`plan`, the lock has `K_old: removing` and `K_new: managed`.
After a successful move, `K_old` has no holder and its entry causes no step [fake].
Two options (open question 3):

- **Drop `K_old`** from the lock after its move succeeded. The command is run by a person, and
  dropping a `removing` entry is how a person releases a key (decision 8). The result equals
  `nextLock` of the new definition, so `--frozen-lock` passes once it is committed.
- **Leave it** `removing`. Harmless, but the lock keeps a dead entry until a person deletes it.

Either way the lock is written only **after** Stripe was changed, and only for keys whose move
succeeded.

### 4.5 Failure and partial apply

- Each move is a single API call, so one price is either moved or not. **Unverified** whether
  Stripe applies `lookup_key` and `metadata` atomically in one request; if not, splitting into
  two calls (key first) keeps the key move, which is what matters, and a stale `pricectl_id` is
  harmless.
- If the command stops part way: moved prices are consistent (new key held, old key without a
  holder). Unmoved ones still hold `K_old`; running `refactor` again detects only them, so the
  command is idempotent.
- **The dangerous path**: a `deploy` of the renamed definition before (or after a partial)
  refactor replaces the unmoved prices, as today (`New` create, `K_old` archive). Nothing in
  the current `deploy` stops it. Open question 5.
- **Concurrent deploys**: a deploy of an older commit that runs after the move looks up
  `K_old`, finds no holder, and creates a new price with `K_old`; the next deploy of the new
  commit archives it (`K_old` is `removing` if the lock still lists it, or untracked if the
  entry was dropped). Decision 8 already requires deploys of one stack to run one at a time;
  `refactor` must be serialized with them too. Dropping `K_old` (4.4) makes this case worse:
  the stray price would no longer be tracked. Not modeled.
- **Several Stripe accounts** (test and live) share one lock but not one Stripe state. The
  move has to run against each account before the rename is deployed there. Open question 5.

## 5. Open questions for the maintainer

1. **Is a command worth it?** Under keys, only prices without `lookupKey` gain anything, and
   pinning `lookupKey: '{stackId}_{Old}'` already keeps them with no new code. The cheaper
   alternative: make `plan`'s rename warning (`renameWarnings`, `plan.ts`) say, for prices,
   "set `lookupKey: '<old key>'` on `<new path>` to keep the price", and correct the README
   sentence of section 2. The command would only add the ability to rename the key itself
   while keeping the price ID.
2. **Products and coupons**: accept that a rename replaces them (and, for a product, all its
   prices), or add a way to pin the key (for example a prop that overrides `key`, which would
   also change `claimedKey` and the lock)? Without it, #51's motivating example works for
   prices but not for products or coupons inside a construct used twice.
3. **Lock after a move**: drop the old key (person releases it) or leave it `removing`?
4. **`pricectl_id`**: nothing reads it. Should refactor (or `deploy`) keep it in sync with
   the logical ID, or should it be documented as "the logical ID at creation"?
5. **Guarding against replacement**: should `plan`/`deploy` refuse (or require a flag) when
   they see a rename candidate that `refactor` could move, so CI cannot replace prices that a
   person meant to move? And how is refactor run per Stripe account (test/live) when CI
   deploys to both?
6. **Coupon `physicalId`** is ignored by the planner (3.4). Separate issue?
7. **Unverified Stripe behavior to check in test mode before implementing 3.1(b)**: moving
   the lookup key of an archived price; `lookup_key` + `metadata` in one update request.

## References

- Issue #51 (this proposal), #44 (price revision), PR #49 (key-based lookup, no state file).
- `design/price-revision/DECISIONS.md` decisions 4, 6, 8, 9; `IMPLEMENTATION.md` known limits.
- [CDK refactoring](https://docs.aws.amazon.com/cdk/v2/guide/refactor.html),
  [CDK logical IDs](https://docs.aws.amazon.com/cdk/v2/guide/identifiers.html).
- Stripe API reference: [update a price](https://docs.stripe.com/api/prices/update),
  [update a product](https://docs.stripe.com/api/products/update),
  [update a coupon](https://docs.stripe.com/api/coupons/update),
  [delete a coupon](https://docs.stripe.com/api/coupons/delete),
  [update a feature](https://docs.stripe.com/api/entitlements/feature/updates),
  [update a billing meter](https://docs.stripe.com/api/billing/meter/update).
