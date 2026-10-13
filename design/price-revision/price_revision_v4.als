/*
 * pricectl: price changes with key-based lookup (v4), one deploy.
 *
 * No listing. Every price slot has a lookup key (the one the definition sets, or one
 * pricectl derives from the stack and logical ID). plan finds the slot's current price as
 * the holder of that key, and its earlier versions through `previous` (metadata
 * pricectl_previous, set at creation). A removed slot is found through its key in
 * pricectl.lock.json. Stripe rules S1-S5 as in price_revision.als (S1-S4 verified).
 */
module price_revision_v4

sig Product {}
sig Key {}
sig Terms {}
sig Attrs {}

abstract sig Tax {}
one sig Unspecified, Inclusive, Exclusive extends Tax {}

sig Price {
  product: one Product,
  terms: one Terms,
  /** metadata pricectl_previous, set when the price is created */
  previous: lone Price
}
fact noCycles { no p: Price | p in p.^previous }

abstract sig State {
  prices: set Price,
  active: set Price,
  key: Price -> lone Key,
  attrs: Price -> lone Attrs,
  tax: Price -> lone Tax,
  default: Product -> lone Price,
  /** metadata pricectl_stack = this stack */
  stack: set Price
}
one sig Pre, Post extends State {}

fact stateShape {
  all s: State {
    s.active + s.stack in s.prices
    (s.key).Key + (s.attrs).Attrs + (s.tax).Tax in s.prices
    all p: s.prices | one p.(s.attrs) and one p.(s.tax)
    Product.(s.default) in s.prices
    all p: s.prices | p.previous in s.prices
  }
}

pred stripeValid[s: State] {
  all k: Key | lone (s.key).k
  all pr: Product, p: pr.(s.default) | p in s.active and p.product = pr
}

/** A price slot: defined in the code, or removed (only its key is left in the lock). */
abstract sig Slot { skey: one Key }
sig Def extends Slot {
  dproduct: one Product,
  dterms: one Terms,
  dattrs: one Attrs,
  dtax: one Tax
}
sig Removed extends Slot {}
sig InactiveDef in Def {}
sig DefaultDef in Def {}
sig TransferDef in Def {}

/** synth and the lock: one slot per key */
fact keysUnique { all disj a, b: Slot | a.skey != b.skey }

pred synthOk {
  all pr: Product | lone (DefaultDef & dproduct.pr)
  no DefaultDef & InactiveDef
}

/* ---------- plan ---------- */

fun holder[s: Slot]: lone Price { (Pre.key).(s.skey) }
/** the slot's versions: the key holder (if it is the stack's) and its predecessors */
fun versions[s: Slot]: set Price { (holder[s] & Pre.stack).*previous & Pre.stack }
fun foreignHolder[s: Slot]: lone Price { holder[s] - Pre.stack }

/**
 * What the previous deploys leave (checked over several deploys in price_keys_v4.qnt):
 * every stack price on sale is a version of some slot, and slots do not share versions.
 */
pred wellFormedPre {
  stripeValid[Pre]
  Pre.active & Pre.stack in Slot.versions
  all disj a, b: Slot | no versions[a] & versions[b]
}

pred reusable[p: Price, d: Def] {
  p.product = d.dproduct and p.terms = d.dterms
  (p.(Pre.tax) = d.dtax or p.(Pre.tax) = Unspecified)
}

/** A key held outside the stack is taken only with transferLookupKey. */
pred planRejects { some d: Def | some foreignHolder[d] and d not in TransferDef }

one sig Run { made: Def -> lone Price }

fun target[d: Def]: lone Price {
  some Run.made[d] => Run.made[d] else (holder[d] & Pre.stack)
}
fun targets: set Price { { p: Price | some d: Def | p = target[d] } }
fun defOf[p: Price]: lone Def { { d: Def | target[d] = p } }
fun archived: set Price { Slot.versions - targets }

pred deploy {
  all d: Def {
    (some h: holder[d] & Pre.stack | reusable[h, d]) => no Run.made[d] else one Run.made[d]
  }
  no Def.(Run.made) & Pre.prices
  all disj d1, d2: Def | no Run.made[d1] & Run.made[d2]
  all d: Def, n: Run.made[d] |
    n.product = d.dproduct and n.terms = d.dterms and n.previous = holder[d] & Pre.stack
  Post.prices = Pre.prices + Def.(Run.made)
  Post.stack = Pre.stack + Def.(Run.made)

  all p: Post.prices |
    p in targets => (p in Post.active iff defOf[p] not in InactiveDef)
    else p in archived => p not in Post.active
    else (p in Post.active iff p in Pre.active)

  -- a target holds its slot's key; a key moved to a target leaves its previous holder
  all p: Post.prices |
    p in targets => p.(Post.key) = defOf[p].skey
    else p.(Pre.key) in Def.skey => no p.(Post.key)
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

pred scenario { wellFormedPre and synthOk and not planRejects and deploy }

/* ---------- Properties ---------- */

assert StripeAcceptsResult { scenario implies stripeValid[Post] }

assert TaxTransitionsLegal {
  scenario implies all p: Pre.prices | p.(Post.tax) != p.(Pre.tax) implies p.(Pre.tax) = Unspecified
}

assert ForeignPricesUntouched {
  scenario implies all p: Pre.prices - Pre.stack {
    p in Post.active iff p in Pre.active
    p.(Post.key) = p.(Pre.key) or (some d: TransferDef | p.(Pre.key) = d.skey)
  }
}

/** A new price only when the key holder cannot be updated in place into the definition. */
assert NewPriceOnlyWhenNeeded {
  scenario implies all d: Def | some Run.made[d] implies no h: holder[d] & Pre.stack | reusable[h, d]
}

assert Realizes {
  scenario implies all d: Def, t: target[d] {
    t.product = d.dproduct and t.terms = d.dterms
    t in Post.active iff d not in InactiveDef
    t.(Post.key) = d.skey
    t.(Post.tax) = d.dtax
    d in DefaultDef implies d.dproduct.(Post.default) = t
  }
}

/** After deploy, a slot has at most its target on sale, and a removed slot nothing. */
assert OneVersionOnSale {
  scenario implies {
    all d: Def | (target[d].*previous & Post.stack) & Post.active in target[d]
    all r: Removed | no versions[r] & Post.active
  }
}

/** The shape of wellFormedPre holds again after deploy, so the next plan reaches everything. */
assert NextPlanReachesEverything {
  scenario implies {
    let postVersions = { s: Slot, p: Price |
        p in ((Post.key).(s.skey) & Post.stack).*previous & Post.stack } |
      Post.active & Post.stack in Slot.postVersions
  }
}

/* ---------- Reachability ---------- */

run newVersionMovesFollowedDefault {
  scenario and some d: Def, pr: Product | some Run.made[d] and pr.(Pre.default) = holder[d] and pr.(Post.default) = Run.made[d]
} for 4 but 2 State, 6 Price
run strayFromFailedDeployArchived {
  scenario and some d: Def | no Run.made[d] and some (versions[d] - holder[d]) & Pre.active
} for 4 but 2 State, 6 Price
run removedSlotArchived { scenario and some r: Removed | some versions[r] & Pre.active } for 4 but 2 State, 6 Price
run keyTakenFromForeignWithFlag { scenario and some d: TransferDef | some foreignHolder[d] } for 4 but 2 State, 6 Price
run inPlaceTax { scenario and some d: Def | no Run.made[d] and holder[d].(Pre.tax) = Unspecified and d.dtax != Unspecified } for 4 but 2 State, 6 Price
run inactiveDefaultUnset { scenario and no DefaultDef and some d: InactiveDef, pr: Product | pr.(Pre.default) = holder[d] and no pr.(Post.default) } for 4 but 2 State, 6 Price

check StripeAcceptsResult for 4 but 2 State, 6 Price
check TaxTransitionsLegal for 4 but 2 State, 6 Price
check ForeignPricesUntouched for 4 but 2 State, 6 Price
check NewPriceOnlyWhenNeeded for 4 but 2 State, 6 Price
check Realizes for 4 but 2 State, 6 Price
check OneVersionOnSale for 4 but 2 State, 6 Price
check NextPlanReachesEverything for 4 but 2 State, 6 Price
