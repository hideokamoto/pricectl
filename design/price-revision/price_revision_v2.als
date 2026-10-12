/*
 * pricectl: price changes after the decisions in DECISIONS.md (v2), one deploy.
 *
 * synthOk and planRejects encode the checks of `synth` and `plan`; the properties are
 * checked for every definition that passes them. Stripe rules S1-S5 are the ones of
 * price_revision.als, all verified in test mode except S5 (from the API spec).
 */
module price_revision_v2

sig Product {}
sig Key {}
sig Terms {}
sig Attrs {}
sig Slot {}

abstract sig Tax {}
one sig Unspecified, Inclusive, Exclusive extends Tax {}

sig Price {
  product: one Product,
  terms: one Terms
}

abstract sig State {
  prices: set Price,
  active: set Price,
  key: Price -> lone Key,
  attrs: Price -> lone Attrs,
  tax: Price -> lone Tax,
  default: Product -> lone Price,
  /** metadata pricectl_id: the logical ID a price was created for */
  tag: Price -> lone Slot,
  /** state file: the price each logical ID currently points to */
  current: Slot -> lone Price
}
one sig Pre, Post extends State {}

fact stateShape {
  all s: State {
    s.active in s.prices
    (s.key).Key + (s.attrs).Attrs + (s.tax).Tax + (s.tag).Slot in s.prices
    all p: s.prices | one p.(s.attrs) and one p.(s.tax)
    Product.(s.default) + Slot.(s.current) in s.prices
  }
}

pred stripeValid[s: State] {
  all k: Key | lone (s.key).k
  all pr: Product, p: pr.(s.default) | p in s.active and p.product = pr
}

pred wellFormedPre {
  stripeValid[Pre]
  all disj a, b: Slot | no a.(Pre.current) & b.(Pre.current)
  -- the state file points at prices created for that logical ID
  all s: Slot, p: s.(Pre.current) | p.(Pre.tag) = s
}

sig Def {
  slot: one Slot,
  dproduct: one Product,
  dterms: one Terms,
  dkey: lone Key,
  dattrs: one Attrs,
  dtax: one Tax
}
sig InactiveDef in Def {}
/** isDefault: true */
sig DefaultDef in Def {}
/** transferLookupKey: true */
sig TransferDef in Def {}

fact oneDefPerSlot { all disj d1, d2: Def | d1.slot != d2.slot }

/* ---------- synth: checks of the definition alone ---------- */

pred synthOk {
  all disj d1, d2: Def | no d1.dkey & d2.dkey
  all pr: Product | lone (DefaultDef & dproduct.pr)
  no DefaultDef & InactiveDef
}

/* ---------- plan ---------- */

fun cur[d: Def]: lone Price { d.slot.(Pre.current) }
fun stateSlots: set Slot { (Pre.current).Price }
fun orphanSlots: set Slot { stateSlots - Def.slot }
fun stackSlots: set Slot { Def.slot + stateSlots }
/** Prices of the slot: its current version and stray versions (tagged, not in the state file). */
fun versions[d: Def]: set Price { (Pre.tag).(d.slot) }
fun strays[d: Def]: set Price { versions[d] - cur[d] }
fun orphanPrices: set Price { (Pre.tag).orphanSlots }
fun foreignPrices: set Price { Pre.prices - (Pre.tag).stackSlots }

/** A price that can become the definition by updates in place only. */
pred reusable[p: Price, d: Def] {
  p.product = d.dproduct and p.terms = d.dterms
  (p.(Pre.tax) = d.dtax or p.(Pre.tax) = Unspecified)
}

one sig Run {
  made: Def -> lone Price,
  /** the stray that a definition reuses, when its current version is not reusable */
  adopted: Def -> lone Price
}

fun target[d: Def]: lone Price {
  some Run.made[d] => Run.made[d] else (some Run.adopted[d] => Run.adopted[d] else cur[d])
}
fun targets: set Price { { p: Price | some d: Def | p = target[d] } }
fun defOf[p: Price]: lone Def { { d: Def | target[d] = p } }

fun holder[d: Def]: set Price { (Pre.key).(d.dkey) - target[d] }

/** A lookup key may be taken from: the slot's own versions, prices no longer defined, or
    (with transferLookupKey) prices outside the stack. */
pred keyTakeable[d: Def, h: Price] {
  h in versions[d] or h in orphanPrices or (h in foreignPrices and d in TransferDef)
}

pred planRejects { some d: Def, h: holder[d] | not keyTakeable[d, h] }

fun takenKeys: set Key { { k: Key | some d: Def | k = d.dkey and some holder[d] } }

/* ---------- deploy ---------- */

/** Prices deploy archives: other versions of defined slots, and prices of removed slots. */
fun archived: set Price {
  ({ p: Price | some d: Def | p in versions[d] } - targets) + orphanPrices
}

pred deploy {
  -- the version each definition ends up with
  all d: Def {
    (some cur[d] and reusable[cur[d], d]) => (no Run.made[d] and no Run.adopted[d])
    else (some p: strays[d] | reusable[p, d]) =>
      (no Run.made[d] and one Run.adopted[d] and Run.adopted[d] in strays[d] and reusable[Run.adopted[d], d])
    else (one Run.made[d] and no Run.adopted[d])
  }
  no Def.(Run.made) & Pre.prices
  all disj d1, d2: Def | no Run.made[d1] & Run.made[d2]
  all d: Def, n: Run.made[d] | n.product = d.dproduct and n.terms = d.dterms
  Post.prices = Pre.prices + Def.(Run.made)

  Post.current = { s: Slot, p: Price | some d: Def | s = d.slot and p = target[d] }
  Post.tag = Pre.tag + { p: Price, s: Slot | some d: Def | p = Run.made[d] and s = d.slot }

  all p: Post.prices |
    p in targets => (p in Post.active iff defOf[p] not in InactiveDef)
    else p in archived => p not in Post.active
    else (p in Post.active iff p in Pre.active)

  all p: Post.prices |
    p in targets => p.(Post.key) = defOf[p].dkey
    else p.(Pre.key) in takenKeys => no p.(Post.key)
    else p.(Post.key) = p.(Pre.key)

  all p: Post.prices |
    p in targets => (p.(Post.attrs) = defOf[p].dattrs and p.(Post.tax) = defOf[p].dtax)
    else (p.(Post.attrs) = p.(Pre.attrs) and p.(Post.tax) = p.(Pre.tax))

  -- default price: declared, or followed (moved to the new version or unset)
  all pr: Product |
    (some d: DefaultDef | d.dproduct = pr) =>
      pr.(Post.default) = target[{ d: DefaultDef | d.dproduct = pr }]
    else let p = pr.(Pre.default) |
      no p => no pr.(Post.default)
      else (some d: Def | p in versions[d]) =>
        (let t = target[{ d: Def | p in versions[d] }] |
          (t in Post.active and t.product = pr) => pr.(Post.default) = t
          else no pr.(Post.default))
      else p in archived => no pr.(Post.default)
      else pr.(Post.default) = p
}

pred scenario { wellFormedPre and synthOk and not planRejects and deploy }

/* ---------- Properties ---------- */

assert StripeAcceptsResult { scenario implies stripeValid[Post] }

assert TaxTransitionsLegal {
  scenario implies all p: Pre.prices |
    p.(Post.tax) != p.(Pre.tax) implies p.(Pre.tax) = Unspecified
}

/** Prices outside the stack keep their state, except a key the definition explicitly takes. */
assert ForeignPricesUntouched {
  scenario implies all p: foreignPrices {
    p in Post.active iff p in Pre.active
    p.(Post.key) = p.(Pre.key) or (some d: TransferDef | p.(Pre.key) = d.dkey)
  }
}

assert NewPriceOnlyWhenNeeded {
  scenario implies all d: Def | some Run.made[d] implies no p: versions[d] | reusable[p, d]
}

/** Each definition is realized by its current version. */
assert Realizes {
  scenario implies all d: Def, t: d.slot.(Post.current) {
    t.product = d.dproduct and t.terms = d.dterms
    t in Post.active iff d not in InactiveDef
    t.(Post.key) = d.dkey
    t.(Post.tax) = d.dtax
    d in DefaultDef implies d.dproduct.(Post.default) = t
  }
}

/** After deploy a defined slot has no other version on sale, and removed slots none. */
assert NoStrayVersionOnSale {
  scenario implies {
    all d: Def | versions[d] & Post.active in target[d]
    no orphanPrices & Post.active
  }
}

/** plan refuses only when the key is held by a price in use by another definition, or by
    a price outside the stack without transferLookupKey. */
assert PlanRefusesOnlyRealConflicts {
  (wellFormedPre and synthOk and deploy and planRejects) implies
    some d: Def, h: holder[d] |
      (h in foreignPrices and d not in TransferDef) or
      (some d2: Def - d | h = cur[d2] and h in Pre.active)
}

/* ---------- Diagnosis ---------- */

/** H1: the key is held by a version of another definition that is not that definition's
    version in use (an archived old version or a stray). */
pred keyOnUnusedVersionOfOtherDef {
  some d: Def, d2: Def - d, h: holder[d] | h in versions[d2] and not (h = cur[d2] and h in Pre.active)
}

run H1 { wellFormedPre and synthOk and deploy and planRejects and keyOnUnusedVersionOfOtherDef } for 4 but 2 State, 6 Price
check PlanRefusesExplainedByH1 {
  (wellFormedPre and synthOk and deploy and planRejects and not keyOnUnusedVersionOfOtherDef) implies
    some d: Def, h: holder[d] |
      (h in foreignPrices and d not in TransferDef) or
      (some d2: Def - d | h = cur[d2] and h in Pre.active)
} for 4 but 2 State, 6 Price

/* ---------- Reachability: each decided behavior happens in some scenario ---------- */

run newVersionMovesFollowedDefault {
  scenario and some d: Def | some Run.made[d] and some pr: Product |
    pr.(Pre.default) = cur[d] and pr.(Post.default) = Run.made[d]
} for 4 but 2 State, 6 Price
run followedDefaultUnsetWhenArchived {
  scenario and some pr: Product | some pr.(Pre.default) and no pr.(Post.default) and no DefaultDef
} for 4 but 2 State, 6 Price
run declaredDefaultSet {
  scenario and some d: DefaultDef | d.dproduct.(Pre.default) != target[d]
} for 4 but 2 State, 6 Price
run strayReused { scenario and some Run.adopted } for 4 but 2 State, 6 Price
run strayArchived {
  scenario and some d: Def, p: strays[d] | p in Pre.active and p not in Post.active
} for 4 but 2 State, 6 Price
run keyTakenFromForeignWithFlag {
  scenario and some d: TransferDef, h: holder[d] | h in foreignPrices
} for 4 but 2 State, 6 Price
run keyTakenFromOrphan {
  scenario and some d: Def, h: holder[d] | h in orphanPrices
} for 4 but 2 State, 6 Price
run inPlaceTaxFromUnspecified {
  scenario and some d: Def | no Run.made[d] and some cur[d] and
    cur[d].(Pre.tax) = Unspecified and d.dtax != Unspecified
} for 4 but 2 State, 6 Price
run newVersionForTaxChange {
  scenario and some d: Def | some Run.made[d] and some cur[d] and
    cur[d].terms = d.dterms and cur[d].product = d.dproduct
} for 4 but 2 State, 6 Price
run inactiveDefOfDefaultPrice {
  scenario and some d: InactiveDef | some cur[d] and cur[d] in Product.(Pre.default)
} for 4 but 2 State, 6 Price

/* ---------- Proposed fix for H1 (G9): any price of the stack gives up its key ----------
 * synth rejects two definitions with the same key, so no two definitions compete for one.
 */
pred keyTakeableExt[d: Def, h: Price] {
  h in (Pre.tag).stackSlots or (h in foreignPrices and d in TransferDef)
}
pred planRejectsExt { some d: Def, h: holder[d] | not keyTakeableExt[d, h] }
pred scenarioExt { wellFormedPre and synthOk and not planRejectsExt and deploy }

check StripeAcceptsResultExt { scenarioExt implies stripeValid[Post] } for 4 but 2 State, 6 Price
check ForeignPricesUntouchedExt {
  scenarioExt implies all p: foreignPrices {
    p in Post.active iff p in Pre.active
    p.(Post.key) = p.(Pre.key) or (some d: TransferDef | p.(Pre.key) = d.dkey)
  }
} for 4 but 2 State, 6 Price
check RealizesExt {
  scenarioExt implies all d: Def, t: d.slot.(Post.current) {
    t.product = d.dproduct and t.terms = d.dterms
    t in Post.active iff d not in InactiveDef
    t.(Post.key) = d.dkey
    t.(Post.tax) = d.dtax
    d in DefaultDef implies d.dproduct.(Post.default) = t
  }
} for 4 but 2 State, 6 Price
check TaxTransitionsLegalExt {
  scenarioExt implies all p: Pre.prices |
    p.(Post.tax) != p.(Pre.tax) implies p.(Pre.tax) = Unspecified
} for 4 but 2 State, 6 Price
check NoStrayVersionOnSaleExt {
  scenarioExt implies {
    all d: Def | versions[d] & Post.active in target[d]
    no orphanPrices & Post.active
  }
} for 4 but 2 State, 6 Price
/** With the fix, plan refuses only for a key held outside the stack without transferLookupKey. */
check PlanRefusesOnlyForeignWithoutFlagExt {
  (wellFormedPre and synthOk and deploy and planRejectsExt) implies
    some d: Def, h: holder[d] | h in foreignPrices and d not in TransferDef
} for 4 but 2 State, 6 Price
run keyTakenFromOtherDefinition {
  scenarioExt and some d: Def, d2: Def - d, h: holder[d] | h in versions[d2]
} for 4 but 2 State, 6 Price

pred show { scenario and some Run.made and some Run.adopted and some DefaultDef }

run show for 4 but 2 State, 6 Price
check StripeAcceptsResult for 4 but 2 State, 6 Price
check TaxTransitionsLegal for 4 but 2 State, 6 Price
check ForeignPricesUntouched for 4 but 2 State, 6 Price
check NewPriceOnlyWhenNeeded for 4 but 2 State, 6 Price
check Realizes for 4 but 2 State, 6 Price
check NoStrayVersionOnSale for 4 but 2 State, 6 Price
check PlanRefusesOnlyRealConflicts for 4 but 2 State, 6 Price
