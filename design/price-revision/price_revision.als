/*
 * pricectl: To-be design of price changes (one deploy, before -> after).
 *
 * The model encodes the To-be table literally and checks whether the state it
 * produces is accepted by Stripe and leaves resources outside the stack alone.
 * A counterexample means: following the To-be design, deploy either gets
 * rejected by Stripe or changes something it should not.
 *
 * Stripe rules used (source in brackets):
 *  S1 A lookup key belongs to at most one price; transfer_lookup_key moves it.
 *     [API spec: transfer_lookup_key "atomically remove the lookup key from the
 *     existing price, and assign it to this price"; uniqueness also observed in
 *     issue #44. ASSUMPTION: archived prices count as holders too.]
 *  S2 A product's default price is an active price. [docs: "The default price
 *     must be an active price"; archiving it rejected, issue #44]
 *  S3 The default price belongs to that product. [ASSUMPTION, not verified]
 *  S4 tax_behavior can change only while it is unspecified. [API spec: "Once
 *     specified as either inclusive or exclusive, it cannot be changed."]
 *  S5 product, currency, amounts, recurring, tiers (= Terms) never change.
 *     [API spec: not among the update parameters]
 */
module price_revision

sig Product {}
sig Key {}
/** Fields Stripe cannot change: currency, amounts, recurring, tiers, ... */
sig Terms {}
/** Fields Stripe can change freely: nickname, metadata */
sig Attrs {}
/** Logical ID of a Price construct (the "slot" in the user's mental model) */
sig Slot {}

abstract sig Tax {}
one sig Unspecified, Inclusive, Exclusive extends Tax {}

/** A Stripe Price. product and terms are immutable (S5) by construction. */
sig Price {
  product: one Product,
  terms: one Terms
}

/** Stripe as seen by pricectl: Stripe objects plus the state file (current). */
abstract sig State {
  prices: set Price,
  active: set Price,
  key: Price -> lone Key,
  attrs: Price -> lone Attrs,
  tax: Price -> lone Tax,
  default: Product -> lone Price,
  /** state file: the price each logical ID currently points to */
  current: Slot -> lone Price
}
one sig Pre, Post extends State {}

fact stateShape {
  all s: State {
    s.active in s.prices
    (s.key).Key in s.prices
    all p: s.prices | one p.(s.attrs) and one p.(s.tax)
    (s.attrs).Attrs + (s.tax).Tax in s.prices
    Product.(s.default) in s.prices
    Slot.(s.current) in s.prices
  }
}

/** What Stripe accepts as a state. */
pred stripeValid[s: State] {
  -- S1
  all k: Key | lone (s.key).k
  -- S2, S3
  all pr: Product, p: pr.(s.default) | p in s.active and p.product = pr
}

/** Assumptions about the state before deploy. */
pred wellFormedPre {
  stripeValid[Pre]
  -- the state file never points two logical IDs at one price
  all disj a, b: Slot | no a.(Pre.current) & b.(Pre.current)
}

/** One Price construct in the definition. */
sig Def {
  slot: one Slot,
  dproduct: one Product,
  dterms: one Terms,
  dkey: lone Key,
  dattrs: one Attrs,
  dtax: one Tax
}
/** Defs that set active: false */
sig InactiveDef in Def {}

fact oneDefPerSlot { all disj d1, d2: Def | d1.slot != d2.slot }

/* ---------- To-be classification ---------- */

fun cur[d: Def]: lone Price { d.slot.(Pre.current) }
fun orphanSlots: set Slot { (Pre.current).Price - Def.slot }
fun orphanPrices: set Price { orphanSlots.(Pre.current) }

/** To-be: a renamed price is the orphan that holds the lookup key the new logical ID defines. */
fun renameSource[d: Def]: set Price {
  no cur[d] => orphanPrices & (Pre.key).(d.dkey) else none
}
fun base[d: Def]: set Price { cur[d] + renameSource[d] }

pred termsSame[d: Def, p: Price] { p.product = d.dproduct and p.terms = d.dterms }

/** To-be: tax changes need a new version only between inclusive and exclusive. */
pred taxNeedsNewVersion[d: Def, p: Price] {
  let t = p.(Pre.tax) | t != Unspecified and d.dtax != Unspecified and t != d.dtax
}

pred create[d: Def] { no base[d] }
/** To-be: terms changed, or a rename (treated like a terms change). */
pred revise[d: Def] {
  one base[d]
  (not termsSame[d, base[d]] or taxNeedsNewVersion[d, base[d]] or some renameSource[d])
}
pred inPlace[d: Def] { one base[d] and not revise[d] }

fun revisedBases: set Price { { p: Price | some d: Def | revise[d] and p = base[d] } }

/* ---------- To-be deploy: the state after deploy ---------- */

/** The price that a definition ends up pointing to. */
one sig Run { made: Def -> lone Price }
fun target[d: Def]: lone Price { some Run.made[d] => Run.made[d] else base[d] }
fun targets: set Price { { p: Price | some d: Def | p = target[d] } }
fun defOf[p: Price]: lone Def { { d: Def | target[d] = p } }

/** Keys that a new version takes with transfer_lookup_key (To-be: revisions transfer). */
fun transferredKeys: set Key { { k: Key | some d: Def | revise[d] and k = d.dkey } }

pred deployToBe {
  -- a new Stripe price for every create and revise
  all d: Def | (create[d] or revise[d]) iff one Run.made[d]
  no Def.(Run.made) & Pre.prices
  all disj d1, d2: Def | no Run.made[d1] & Run.made[d2]
  all d: Def | some Run.made[d] => termsSame[d, Run.made[d]]
  Post.prices = Pre.prices + Def.(Run.made)

  -- state file: defined logical IDs point at their target, orphans are dropped
  Post.current = { s: Slot, p: Price | some d: Def | s = d.slot and p = target[d] }

  -- active: targets as defined; revised bases and orphans archived; the rest unchanged
  all p: Post.prices |
    p in targets => (p in Post.active iff defOf[p] not in InactiveDef)
    else p in revisedBases + orphanPrices => p not in Post.active
    else (p in Post.active iff p in Pre.active)

  -- lookup keys: targets get the defined key; a transferred key leaves its holder
  all p: Post.prices |
    p in targets => p.(Post.key) = defOf[p].dkey
    else p.(Pre.key) in transferredKeys => no p.(Post.key)
    else p.(Post.key) = p.(Pre.key)

  -- mutable fields: targets as defined, the rest unchanged
  all p: Post.prices |
    p in targets => (p.(Post.attrs) = defOf[p].dattrs and p.(Post.tax) = defOf[p].dtax)
    else (p.(Post.attrs) = p.(Pre.attrs) and p.(Post.tax) = p.(Pre.tax))

  -- default price: To-be moves it from a revised base to the new version
  all pr: Product |
    (some d: Def | revise[d] and pr.(Pre.default) = base[d]) =>
      pr.(Post.default) = Run.made[{ d: Def | revise[d] and pr.(Pre.default) = base[d] }]
    else pr.(Post.default) = pr.(Pre.default)
}

/* ---------- Properties ---------- */

/** Stripe accepts the state that deploy produces. */
assert StripeAcceptsResult { wellFormedPre and deployToBe implies stripeValid[Post] }

/** No update changes tax_behavior once it is inclusive or exclusive (S4). */
assert TaxTransitionsLegal {
  wellFormedPre and deployToBe implies
    all p: Pre.prices | p.(Post.tax) != p.(Pre.tax) implies p.(Pre.tax) = Unspecified
}

/** Prices that were never part of the stack keep their state. */
assert ForeignPricesUntouched {
  wellFormedPre and deployToBe implies
    all p: Pre.prices - Slot.(Pre.current) |
      (p in Post.active iff p in Pre.active) and p.(Post.key) = p.(Pre.key)
}

/** A new Stripe price (new ID) is made only when Stripe cannot update the existing one. */
assert NewPriceOnlyWhenNeeded {
  wellFormedPre and deployToBe implies
    all d: Def | some Run.made[d] implies
      (no base[d] or not termsSame[d, base[d]] or taxNeedsNewVersion[d, base[d]]
       or base[d].(Pre.tax) != Unspecified and d.dtax != base[d].(Pre.tax))
}

/** Every definition falls into exactly one To-be case. */
assert ClassificationTotal {
  wellFormedPre implies all d: Def |
    (create[d] and not revise[d] and not inPlace[d]) or
    (revise[d] and not create[d] and not inPlace[d]) or
    (inPlace[d] and not create[d] and not revise[d])
}

/* ---------- Diagnosis: the causes of each counterexample ----------
 * Each cause below is checked twice: a run shows that it really breaks the
 * property, and the "...ExplainedBy..." check shows that, within the scope,
 * nothing else does (UNSAT = the list of causes is complete).
 */

/** G1: two definitions declare the same lookup key. */
pred dupKeyInDefs { some disj d1, d2: Def | some d1.dkey and d1.dkey = d2.dkey }

/** G2: a created or in-place definition wants a key that another price holds and nothing transfers it. */
pred keyHeldWithoutTransfer {
  some d: Def, p: Pre.prices |
    (create[d] or inPlace[d]) and some d.dkey and p.(Pre.key) = d.dkey
    and p not in base[d] and d.dkey not in transferredKeys
}

/** G3: the default price ends up inactive because the definition sets active: false. */
pred inactiveDefault {
  some d: Def | d in InactiveDef and some base[d] and base[d] in Product.(Pre.default)
}

/** G4: a price that is no longer defined, and is not renamed, is its product's default price. */
pred orphanIsDefault {
  some p: orphanPrices - { q: Price | some d: Def | q in renameSource[d] } | p in Product.(Pre.default)
}

/** G5: a revision moves the price to another product while the old price is the default price. */
pred productChangeOfDefault {
  some d: Def | revise[d] and base[d] in Product.(Pre.default) and d.dproduct != base[d].product
}

/** G6: an in-place update sets tax_behavior back to unspecified (or between two specified values). */
pred taxResetInPlace {
  some d: Def | inPlace[d] and base[d].(Pre.tax) != Unspecified and d.dtax != base[d].(Pre.tax)
}

/** G7: a revision takes, by transfer, a lookup key held by a price outside the stack. */
pred revisionStealsForeignKey {
  some d: Def, p: Pre.prices - Slot.(Pre.current) | revise[d] and some d.dkey and p.(Pre.key) = d.dkey
}

/** G8: a rename whose terms did not change still makes a new price. */
pred renameWithSameTerms {
  some d: Def | some renameSource[d] and termsSame[d, base[d]] and not taxNeedsNewVersion[d, base[d]]
}

run G1 { wellFormedPre and deployToBe and dupKeyInDefs and not stripeValid[Post] } for 4 but 2 State, 6 Price
run G2 { wellFormedPre and deployToBe and keyHeldWithoutTransfer and not dupKeyInDefs and not stripeValid[Post] } for 4 but 2 State, 6 Price
run G3 { wellFormedPre and deployToBe and inactiveDefault and not stripeValid[Post] } for 4 but 2 State, 6 Price
run G4 { wellFormedPre and deployToBe and orphanIsDefault and not stripeValid[Post] } for 4 but 2 State, 6 Price
run G5 { wellFormedPre and deployToBe and productChangeOfDefault and not inactiveDefault and not stripeValid[Post] } for 4 but 2 State, 6 Price
run G6 { wellFormedPre and deployToBe and taxResetInPlace and some p: Pre.prices | p.(Post.tax) != p.(Pre.tax) and p.(Pre.tax) != Unspecified } for 4 but 2 State, 6 Price
run G7 { wellFormedPre and deployToBe and revisionStealsForeignKey and some p: Pre.prices - Slot.(Pre.current) | p.(Post.key) != p.(Pre.key) } for 4 but 2 State, 6 Price
run G8 { wellFormedPre and deployToBe and renameWithSameTerms } for 4 but 2 State, 6 Price

check StripeAcceptsResultExplainedByG1toG5 {
  wellFormedPre and deployToBe
  and not dupKeyInDefs and not keyHeldWithoutTransfer and not inactiveDefault
  and not orphanIsDefault and not productChangeOfDefault
  implies stripeValid[Post]
} for 4 but 2 State, 6 Price
check TaxExplainedByG6 { wellFormedPre and deployToBe and not taxResetInPlace implies
  all p: Pre.prices | p.(Post.tax) != p.(Pre.tax) implies p.(Pre.tax) = Unspecified } for 4 but 2 State, 6 Price
check ForeignExplainedByG7 { wellFormedPre and deployToBe and not revisionStealsForeignKey implies
  all p: Pre.prices - Slot.(Pre.current) |
    (p in Post.active iff p in Pre.active) and p.(Post.key) = p.(Pre.key) } for 4 but 2 State, 6 Price
check NewPriceExplainedByG8 { wellFormedPre and deployToBe and not renameWithSameTerms implies
  all d: Def | some Run.made[d] implies
    (no base[d] or not termsSame[d, base[d]] or taxNeedsNewVersion[d, base[d]]) } for 4 but 2 State, 6 Price

pred show { wellFormedPre and deployToBe and some d: Def | revise[d] }

run show for 4 but 2 State, 6 Price
check ClassificationTotal for 4 but 2 State, 6 Price
check StripeAcceptsResult for 4 but 2 State, 6 Price
check TaxTransitionsLegal for 4 but 2 State, 6 Price
check ForeignPricesUntouched for 4 but 2 State, 6 Price
check NewPriceOnlyWhenNeeded for 4 but 2 State, 6 Price
