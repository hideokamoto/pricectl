// pricectl: a price slot located by its lookup key (v4), over several deploys.
//
// No listing: plan finds the slot's current price as the holder of its lookup key and
// follows `previous` pointers (metadata pricectl_previous, written when a version is
// created) to the versions before it. Deploy only moves forward, with no undo:
//   1. if the holder does not match the definition: create a price with the definition,
//      transfer_lookup_key and previous = holder (one atomic call; the key moves with it)
//   2. activate or deactivate the target as defined
//   3. archive every other version on sale, reached through `previous`, one call each
// A removed slot (lock entry "removing") archives every version on sale.
// Every call can fail; a create can fail after Stripe created the price (timeout).
module price_keys_v4 {
  val IDS: List[str] = ["P1", "P2", "P3", "P4"]
  val MAX_RUNS: int = 3

  type St = {
    // Stripe
    exists: Set[str],
    terms: str -> int,        // the price's terms (amount etc.), fixed at creation
    previous: str -> str,     // metadata pricectl_previous ("" for the first version)
    active: Set[str],
    keyHolder: str,           // the price holding the slot's lookup key ("" if none)
    // definition (latest commit)
    defined: bool,            // false once the slot is removed (lock entry "removing")
    defTerms: int,
    defActive: bool,
    // the deploy in progress
    phase: str,               // "idle" | "create" | "activate" | "archive"
    target: str,
    chain: Set[str],          // versions plan reached from the key holder
    runs: int,
    failed: bool,
    // the last finished deploy
    lastRan: bool,
    lastClean: bool,
  }

  var s: St

  action init = {
    nondet t = Set(0, 1).oneOf()
    nondet a = Set(true, false).oneOf()
    s' = {
      exists: Set(), terms: Map(), previous: Map(), active: Set(), keyHolder: "",
      defined: true, defTerms: t, defActive: a,
      phase: "idle", target: "", chain: Set(), runs: 0, failed: false,
      lastRan: false, lastClean: false,
    }
  }

  // Versions reachable from the key holder through `previous` (at most 4 hops).
  def reach(st: St): Set[str] = {
    val h = st.keyHolder
    val p1 = if (h != "" and st.previous.keys().contains(h)) st.previous.get(h) else ""
    val p2 = if (p1 != "" and st.previous.keys().contains(p1)) st.previous.get(p1) else ""
    val p3 = if (p2 != "" and st.previous.keys().contains(p2)) st.previous.get(p2) else ""
    Set(h, p1, p2, p3).exclude(Set(""))
  }

  def nextId(st: St): str =
    if (not(st.exists.contains("P1"))) "P1" else if (not(st.exists.contains("P2"))) "P2"
    else if (not(st.exists.contains("P3"))) "P3" else if (not(st.exists.contains("P4"))) "P4" else ""

  // A developer changes the definition (terms or active), or removes the slot.
  action commit = {
    nondet t = Set(0, 1, 2).oneOf()
    nondet a = Set(true, false).oneOf()
    nondet remove = Set(true, false).oneOf()
    all {
      s.phase == "idle",
      s.defined,
      s' = { ...s, defTerms: t, defActive: a, defined: not(remove), lastRan: false },
    }
  }

  action deployStart = all {
    s.phase == "idle",
    s.runs < MAX_RUNS,
    val c = reach(s)
    val h = s.keyHolder
    val reuse = h != "" and s.terms.get(h) == s.defTerms
    s' = { ...s, runs: s.runs + 1, failed: false, chain: c,
      phase: if (not(s.defined)) "archive" else if (reuse) "activate" else "create",
      target: if (not(s.defined)) "" else if (reuse) h else "" },
  }

  action deployCreate = {
    nondet outcome = Set("ok", "failedNotCreated", "failedButCreated").oneOf()
    val id = nextId(s)
    all {
      s.phase == "create",
      id != "",
      if (outcome == "failedNotCreated")
        s' = { ...s, phase: "idle", failed: true, lastRan: true, lastClean: false }
      else
        s' = { ...s,
          exists: s.exists.union(Set(id)),
          terms: s.terms.put(id, s.defTerms),
          previous: s.previous.put(id, s.keyHolder),
          active: if (s.defActive) s.active.union(Set(id)) else s.active,
          keyHolder: id,
          target: id,
          chain: s.chain.union(Set(id)),
          phase: if (outcome == "ok") "activate" else "idle",
          failed: outcome != "ok",
          lastRan: outcome != "ok", lastClean: false,
        },
    }
  }

  action deployActivate = {
    nondet fails = Set(true, false).oneOf()
    val want = s.defActive
    val isOn = s.active.contains(s.target)
    all {
      s.phase == "activate",
      if (want == isOn)
        s' = { ...s, phase: "archive" }
      else if (fails)
        s' = { ...s, phase: "idle", failed: true, lastRan: true, lastClean: false }
      else
        s' = { ...s, phase: "archive",
          active: if (want) s.active.union(Set(s.target)) else s.active.exclude(Set(s.target)) },
    }
  }

  // Archive one other version on sale per call; done when none is left.
  action deployArchive = {
    nondet p = Set("P1", "P2", "P3", "P4").oneOf()
    nondet fails = Set(true, false).oneOf()
    val others = s.chain.exclude(Set(s.target)).intersect(s.active)
    all {
      s.phase == "archive",
      if (others.size() == 0)
        s' = { ...s, phase: "idle", lastRan: true, lastClean: not(s.failed) }
      else all {
        others.contains(p),
        if (fails)
          s' = { ...s, phase: "idle", failed: true, lastRan: true, lastClean: false }
        else
          s' = { ...s, active: s.active.exclude(Set(p)) },
      },
    }
  }

  action stutter = all { s.phase == "idle", s.runs == MAX_RUNS, s' = s }

  action step = any { commit, deployStart, deployCreate, deployActivate, deployArchive, stutter }

  // ---------- Properties ----------

  // No price on sale is out of reach: every version on sale is reachable from the key holder.
  val noUnreachablePriceOnSale: bool = s.active.forall(p => reach(s).contains(p))

  // A deploy that finished without failures leaves exactly the definition on sale.
  val cleanDeployConverges: bool =
    not(s.phase == "idle" and s.lastRan and s.lastClean) or
      (if (not(s.defined)) s.active.size() == 0
       else all {
         s.keyHolder != "",
         s.terms.get(s.keyHolder) == s.defTerms,
         s.active == (if (s.defActive) Set(s.keyHolder) else Set()),
       })

  // Witnesses: these must be violated.
  val witnessNoRecoveryAfterFailure: bool = not(s.lastRan and s.lastClean and s.exists.size() >= 2 and s.runs >= 2)
  val witnessNoFailButCreated: bool = not(s.active.size() >= 2)
}
