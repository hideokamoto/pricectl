# Price revision: decisions

Decisions for issue #44, made after the gaps found by the v1 models
(`price_revision.als`, `price_revision.qnt`). The v2 models encode these decisions.

## User's mental model

A `Price` construct is a slot ("the monthly price of the Pro plan"). Its logical ID names
the slot; the Stripe Price it points to is the slot's current version. Stripe prices are
versions: fields Stripe cannot change require a new version, and old versions stay with
existing subscriptions.

## Decisions

1. **Validation layers and commands**
   - `pricectl lint`: type checking (`tsc --noEmit` equivalent). Separate issue.
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
4. **Lookup keys**: taken over automatically from any price of the stack. Taken from a
   price outside the stack only when the definition sets `transferLookupKey: true`; `plan`
   shows which price it is taken from. Otherwise `plan` refuses. synth rejects two
   definitions with the same key, so definitions never compete for one. (Widened after
   the v2 verification, see G9 below.)
   - A price belongs to the stack when its metadata `pricectl_id` is a logical ID the
     definition uses, or a logical ID recorded in the state file. Ownership is read from
     the object itself, as kubectl does, rather than only from the state file, as
     Terraform and CloudFormation do.
   - So without a state file, prices tagged with a defined logical ID still belong to the
     stack. Prices of logical IDs no longer defined are only known from the state file;
     without it they count as outside the stack (and, as today, nothing is removed).
5. **Default price**
   - Declared with `isDefault: true` on a `Price`: pricectl makes it the product's default.
   - Not declared: pricectl follows what is set in Stripe. When a new version replaces the
     default price, the default moves to it. When the default price is archived, removed,
     or moved to another product, pricectl unsets the default price (`default_price: ''`)
     and `plan` shows it. `destroy` does the same.
6. **Logical IDs are permanent**: changing one replaces the price (new price, old one
   archived). `plan` warns when a new price and a removed price of the same type appear in
   one deploy ("looks like a rename; the price ID changes"). README says not to change
   logical IDs. A rename-only `pricectl refactor` (like `cdk refactor`) is a separate issue.
7. **Failures part way**: undo stays best effort. The next `plan` finds stray versions
   (prices tagged with a slot's logical ID that the state file does not point to): one that
   matches the definition is reused instead of creating another, the others are archived.

## Gap found by the v2 verification

**G9** (resolved by decision 4 as written above). The first version of decision 4 only
took keys from the slot's own versions and from prices no longer defined. `plan` then
refused a key held by an unused price of another definition: an archived old version or a
stray. Example: deploy 1 changes price A's key from `k` to `k2` together with its amount,
so the archived old version of A keeps `k` (archived prices keep their key, verified);
deploy 2 gives `k` to price B, and `plan` refused although nothing uses the old version.
The v2 Alloy model checks the widened rule (`*Ext` checks): every property holds, and
`plan` refuses only for a key held outside the stack without `transferLookupKey`.

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
