# Price revision: decisions

Decisions for issue #44. The current design is v3: no state file. v1 and v2 models are
kept as the record of the gaps that led here.

## User's mental model

A `Price` construct is a slot ("the monthly price of the Pro plan"). Its logical ID names
the slot; the Stripe Price it points to is the slot's current version. Stripe prices are
versions: fields Stripe cannot change require a new version, and old versions stay with
existing subscriptions.

## Decisions

1. **Validation layers and commands**
   - `pricectl lint`: type checking (`tsc --noEmit` equivalent). #50.
   - `pricectl synth`: checks of the definition alone (no Stripe access).
   - `pricectl plan` (new, like `terraform plan`): reads Stripe, shows what deploy would do,
     and refuses (changing nothing) when any step would be rejected by Stripe.
     `deploy` builds the same plan before changing anything.
   - `pricectl diff` stays a diff.
   - `deploy --dry-run` is replaced by `plan`; `destroy --dry-run` stays.
2. **synth checks**: two definitions with the same lookup key; two default prices for one
   product; `isDefault: true` with `active: false` (also excluded by the type).
3. **Update in place, new version only when needed**: `nickname`, `active`, `lookup_key`,
   `metadata`, and `tax_behavior` while it is `unspecified` are updated in place. Any other
   change (product, currency, amounts, recurring, tiers, transform_quantity, or a
   `tax_behavior` change once it is `inclusive` or `exclusive`, including back to
   `unspecified` or removing the property) makes a new version.
4. **Lookup keys**: taken over automatically from any price of the stack; from a price
   outside the stack only when the definition sets `transferLookupKey: true` (`plan` shows
   which price). Otherwise `plan` refuses. synth rejects two definitions with the same key,
   so definitions never compete for one.
5. **Default price**
   - Declared with `isDefault: true` on a `Price`: pricectl makes it the product's default.
   - Not declared: pricectl follows what is set in Stripe. When a new version replaces the
     default price, the default moves to it. When the default price is archived, removed,
     or moved to another product, pricectl unsets it (`default_price: ''`) and `plan` shows
     it. `destroy` does the same.
6. **Logical IDs are permanent**: changing one replaces the price (new price, old one
   archived). `plan` warns when a new price and a removed price of the same type appear in
   one deploy ("looks like a rename; the price ID changes"). README says not to change
   logical IDs. A rename-only `pricectl refactor` (like `cdk refactor`) is #51.
7. **Versions of a slot**: every price tagged with the slot's logical ID is a version of it.
   `plan` picks a version that can be updated in place into the definition (one on sale
   first), and only otherwise creates a price. All other versions of the slot are archived.
   This also cleans up after a deploy that failed part way: undo stays best effort.
8. **No state file** (replaces `pricectl.state.json`). Ownership is recorded where it is
   shared by everyone who deploys, so a teammate, CI and a new machine all see the same plan.
   - **Metadata** for everything that has it (products, prices, coupons, entitlement
     features): `pricectl_stack` (the stack ID) and `pricectl_id` (the logical ID). A
     resource belongs to the stack when it carries the stack's tag. Resources tagged with a
     logical ID the definition no longer has are removed, with the existing approval prompt.
   - **`pricectl.lock.json`, committed to Git**, for what Stripe cannot tag: billing meters
     have no metadata. The lock lists, per stack, the event names of its meters
     (`"managed"`, or `"removing"` after the meter left the definition). It contains no
     Stripe IDs and no timestamps, so it changes only when the definition does.
   - The lock is a function of the previous lock and the definition only, never of Stripe:
     a defined event name is `managed`; a `managed` or `removing` name no longer defined is
     `removing`. A `removing` entry is never dropped automatically; a person drops it by
     editing the lock, which releases the event name. Reading Stripe to drop entries could
     race with a deploy that is still creating the meter and leave it untracked.
   - `synth`, `plan` and `deploy` update the lock locally. With `--frozen-lock` (for CI)
     they refuse when the lock is not what the definition implies ("run pricectl synth and
     commit pricectl.lock.json"), like `npm ci`. CI never writes the lock back.
   - A lock entry claims the **event name**, not one meter (Stripe allows one active meter
     per event name). An active meter with a `managed` name is found and used even when it
     was created outside pricectl; `plan` shows that it adopts a meter it did not create.
     A meter with a `removing` name is deactivated, including one created in the Dashboard
     while the entry was there; `plan` shows it and removal needs approval as for other
     resources.
   - **Deploys of one stack should run one at a time** (one CI job per stack, e.g. a
     concurrency group). pricectl cannot enforce it: Stripe has no lock. Checked in
     `meter_lock_v3b.qnt`: when two deploys overlap, a deploy of an older commit can create a
     meter after a newer deploy planned its removal, so the meter stays on sale. It stays
     tracked (`removing`), so nothing floats, and the next deploy that runs alone removes it.
   - **deploy applies the plan it showed**: every change targets the Stripe IDs `plan` saw.
     A removal deactivates the meter `plan` found for a `removing` name, never a meter
     created after the plan (found by `meter_lock_v3b.qnt`: a deploy still running from an
     older commit would otherwise deactivate a meter created in the Dashboard after a person
     had released the name). A create that meets a meter created after the plan is rejected
     by Stripe (one active meter per event name), and the deploy reports it.
   - `plan` lists each resource type once and indexes it by metadata (the current code lists
     every price again for each price it looks up). Measured in test mode: listing 1,083
     prices takes 3.9-4.5 s (11 pages of 100, about 0.37 s per page, three runs); by pages,
     about 40 s for 10,000 prices. Only up to about 1,000 prices was measured.
   - Without the lock, the meter case is the same as a resource never deployed: defined
     meters are found by event name; nothing is known about removed ones.
   - No migration: pricectl has no users yet, so resources and state files from earlier
     versions are not supported.

## How we got here

- **v1** modeled the first To-be table and found G1-G8 (one deploy) and R1-R3 (failures
  part way). Decisions 1-7 answer them.
- **v2** modeled decisions 1-7 with the state file and found **G9**: `plan` refused a key
  held by an unused price of another definition (an archived old version or a stray).
  Decision 4 was widened to take keys from any price of the stack.
- The state file was then questioned: `pricectl init` puts it in `.gitignore`, so CI and
  each developer had their own; CI never removed resources. Alternatives rejected on the
  way: ownership only from metadata with meters as an exception (meters would behave
  differently from everything else); keeping the record in the Stripe Apps Secret Store
  (not what it is for); recording a meter's owner in the metadata of the prices that use it
  (a meter created before its price failed would float untracked). Decision 8 combines
  metadata with a committed lock that only holds what metadata cannot.
- **v3** models decision 8: `price_revision_v3.als` (prices, ownership from metadata) and
  `meter_lock_v3.qnt` (meters and the lock across commits, CI deploys, failures and
  Dashboard changes).

## Stripe behavior verified in test mode

`verify_stripe.py` (API version `2026-09-30.endive`), output in `verify_stripe.result.txt`.

| Question | Result |
|---|---|
| Archive a product's default price | rejected: "This price cannot be archived because it is the default price of its product." |
| Unset the default price with `default_price: ''` | works; the price can be archived afterwards |
| Default price must be active | yes: an archived price is rejected as default |
| Default price must belong to the product | yes: "Provided price (...) belongs to a different product" |
| Update `lookup_key` in place | works (the docs saying only metadata, nickname and active can change are inaccurate) |
| Take a key held by another price on update | rejected without `transfer_lookup_key`; works with it; `''` unsets |
| An archived price keeps its lookup key | yes: a new price cannot use it without transfer |
| `tax_behavior` unspecified -> inclusive | works |
| `tax_behavior` inclusive -> exclusive / unspecified | rejected: "You cannot update `tax_behavior` field once it has been specified." |
| `tax_behavior` set to its current value | works (no error) |
| Account default tax behavior `inferred_by_currency` | a price created without `tax_behavior` returns `unspecified` |
| Two active meters with one event name | rejected: "An active meter already exists for event name ..." |
| New meter with the event name of a deactivated one | works |
| Reactivate a meter while another with its event name is active | rejected |
| Meter metadata | none (no `metadata` on the object or the create parameters, v1 and v2) |
