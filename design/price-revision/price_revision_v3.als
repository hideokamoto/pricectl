/*
 * pricectl: price changes without a state file (v3), one deploy.
 *
 * Ownership comes from metadata only: a price belongs to the stack when it carries the
 * stack's tag (pricectl_stack) and a logical ID (pricectl_id). There is no pointer to the
 * current version: the version a definition ends up with is a tagged version that can be
 * updated in place into the definition, or a new price. Meters are covered by
 * meter_lock_v3.qnt. Stripe rules S1-S5 as in price_revision.als (S1-S4 verified in test mode).
 */
module price_revision_v3

sig Product {}
sig Key {}
sig Terms {}
sig Attrs {}
/** Logical IDs used by this stack (in the definition or in tags of its prices) */
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
  /** metadata pricectl_stack = this stack, pricectl_id = the slot; untagged prices are outside the stack */
  tag: Price -> lone Slot
}
one sig Pre, Post extends State {}

fact stateShape {
  all s: State {
    s.active in s.prices
    (s.key).Key + (s.attrs).Attrs + (s.tax).Tax + (s.tag).Slot in s.prices
    all p: s.prices | one p.(s.attrs) and one p.(s.tax)
    Product.(s.default) in s.prices
  }
}

pred stripeValid[s: State] {
  all k: Key | lone (s.key).k
  all pr: Product, p: pr.(s.default) | p in s.active and p.product = pr
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
sig DefaultDef in Def {}
sig TransferDef in Def {}

fact oneDefPerSlot { all disj d1, d2: Def | d1.slot != d2.slot }

pred synthOk {
  all disj d1, d2: Def | no d1.dkey & d2.dkey
  all pr: Product | lone (DefaultDef & dproduct.pr)
  no DefaultDef & InactiveDef
}

/* ---------- plan ---------- */

fun versions[d: Def]: set Price { (Pre.tag).(d.slot) }
fun removedSlots: set Slot { Pre.prices.(Pre.tag) - Def.slot }
fun removedPrices: set Price { (Pre.tag).removedSlots }
fun stackPrices: set Price { (Pre.tag).Slot }
fun foreignPrices: set Price { Pre.prices - stackPrices }

pred reusable[p: Price, d: Def] {
  p.product = d.dproduct and p.terms = d.dterms
  (p.(Pre.tax) = d.dtax or p.(Pre.tax) = Unspecified)
}

one sig Run {
  made: Def -> lone Price,
  reused: Def -> lone Price
}

fun target[d: Def]: lone Price { some Run.made[d] => Run.made[d] else Run.reused[d] }
fun targets: set Price { { p: Price | some d: Def | p = target[d] } }
fun defOf[p: Price]: lone Def { { d: Def | target[d] = p } }
fun holder[d: Def]: set Price { (Pre.key).(d.dkey) - target[d] }

/** Decision 4: keys come from any price of the stack, or from outside with transferLookupKey. */
pred keyTakeable[d: Def, h: Price] { h in stackPrices or (h in foreignPrices and d in TransferDef) }
pred planRejects { some d: Def, h: holder[d] | not keyTakeable[d, h] }

fun takenKeys: set Key { { k: Key | some d: Def | k = d.dkey and some holder[d] } }
fun archived: set Price { ({ p: Price | some d: Def | p in versions[d] } - targets) + removedPrices }

pred deploy {
  all d: Def {
    (some p: versions[d] | reusable[p, d]) =>
      (no Run.made[d] and one Run.reused[d] and Run.reused[d] in versions[d] and reusable[Run.reused[d], d]
       -- prefer a version that is already on sale
       and (Run.reused[d] in Pre.active or no p: versions[d] & Pre.active | reusable[p, d]))
    else (one Run.made[d] and no Run.reused[d])
  }
  no Def.(Run.made) & Pre.prices
  all disj d1, d2: Def | no Run.made[d1] & Run.made[d2]
  all d: Def, n: Run.made[d] | n.product = d.dproduct and n.terms = d.dterms
  Post.prices = Pre.prices + Def.(Run.made)
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

pred scenario { stripeValid[Pre] and synthOk and not planRejects and deploy }

/* ---------- Properties ---------- */

assert StripeAcceptsResult { scenario implies stripeValid[Post] }

assert TaxTransitionsLegal {
  scenario implies all p: Pre.prices | p.(Post.tax) != p.(Pre.tax) implies p.(Pre.tax) = Unspecified
}

assert ForeignPricesUntouched {
  scenario implies all p: foreignPrices {
    p in Post.active iff p in Pre.active
    p.(Post.key) = p.(Pre.key) or (some d: TransferDef | p.(Pre.key) = d.dkey)
  }
}

assert NewPriceOnlyWhenNeeded {
  scenario implies all d: Def | some Run.made[d] implies no p: versions[d] | reusable[p, d]
}

assert Realizes {
  scenario implies all d: Def, t: target[d] {
    t.product = d.dproduct and t.terms = d.dterms
    t in Post.active iff d not in InactiveDef
    t.(Post.key) = d.dkey
    t.(Post.tax) = d.dtax
    t.(Post.tag) = d.slot
    d in DefaultDef implies d.dproduct.(Post.default) = t
  }
}

/** One version on sale per definition, none for removed logical IDs. */
assert OneVersionOnSale {
  scenario implies {
    all d: Def | (Post.tag).(d.slot) & Post.active in target[d]
    no removedPrices & Post.active
  }
}

/** plan refuses only for a key held outside the stack without transferLookupKey. */
assert PlanRefusesOnlyForeignWithoutFlag {
  (stripeValid[Pre] and synthOk and deploy and planRejects) implies
    some d: Def, h: holder[d] | h in foreignPrices and d not in TransferDef
}

/* ---------- Reachability ---------- */

run reuseArchivedVersion {
  scenario and some d: Def | some Run.reused[d] and Run.reused[d] not in Pre.active and d not in InactiveDef
} for 4 but 2 State, 6 Price
run newVersionMovesFollowedDefault {
  scenario and some d: Def, pr: Product | some Run.made[d] and pr.(Pre.default) in versions[d] and pr.(Post.default) = Run.made[d]
} for 4 but 2 State, 6 Price
run removedDefaultUnset {
  scenario and no DefaultDef and some pr: Product | pr.(Pre.default) in removedPrices and no pr.(Post.default)
} for 4 but 2 State, 6 Price
run keyFromRemovedPrice { scenario and some d: Def, h: holder[d] | h in removedPrices } for 4 but 2 State, 6 Price
run keyFromForeignWithFlag { scenario and some d: TransferDef, h: holder[d] | h in foreignPrices } for 4 but 2 State, 6 Price
run twoVersionsOnSaleCollapse {
  scenario and some d: Def | #(versions[d] & Pre.active) > 1
} for 4 but 2 State, 6 Price

check StripeAcceptsResult for 4 but 2 State, 6 Price
check TaxTransitionsLegal for 4 but 2 State, 6 Price
check ForeignPricesUntouched for 4 but 2 State, 6 Price
check NewPriceOnlyWhenNeeded for 4 but 2 State, 6 Price
check Realizes for 4 but 2 State, 6 Price
check OneVersionOnSale for 4 but 2 State, 6 Price
check PlanRefusesOnlyForeignWithoutFlag for 4 but 2 State, 6 Price
