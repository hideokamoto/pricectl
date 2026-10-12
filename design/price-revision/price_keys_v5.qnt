// pricectl: a price slot whose lookup key can change (v5), over several deploys.
//
// Extends price_keys_v4.qnt with pricectl.lock.json holding the stack's lookup keys:
// the defined key is "managed"; a key no longer defined is "removing" until a person drops
// it (release). Changing the slot's key is a removal plus an addition: the old key's prices
// are archived, a price with the new key is created. plan reaches a key's versions through
// its holder and the `previous` chain, for managed and removing keys alike.
module price_keys_v5 {
  val KEYS: Set[str] = Set("K1", "K2")
  val MAX_RUNS: int = 3

  type St = {
    // Stripe
    exists: Set[str],
    terms: str -> int,
    key: str -> str,          // the lookup key a price holds ("" if none)
    previous: str -> str,
    active: Set[str],
    // definition (latest commit)
    defined: bool,
    defKey: str,
    defTerms: int,
    defActive: bool,
    // pricectl.lock.json: key -> "managed" | "removing" | "" (no entry)
    lock: str -> str,
    released: Set[str],       // prices under a key a person dropped from the lock
    // the deploy in progress
    phase: str,               // "idle" | "create" | "activate" | "archive"
    target: str,
    chain: Set[str],          // versions of the defined key, as plan saw them
    toArchive: Set[str],      // versions of removing keys, as plan saw them
    runs: int,
    failed: bool,
    lastRan: bool,
    lastClean: bool,
  }

  var s: St

  def holderOf(st: St, k: str): str =
    st.exists.filter(p => st.key.get(p) == k).fold("", (acc, p) => p)

  def reachKey(st: St, k: str): Set[str] = {
    val h = holderOf(st, k)
    val p1 = if (h != "" and st.previous.keys().contains(h)) st.previous.get(h) else ""
    val p2 = if (p1 != "" and st.previous.keys().contains(p1)) st.previous.get(p1) else ""
    val p3 = if (p2 != "" and st.previous.keys().contains(p2)) st.previous.get(p2) else ""
    Set(h, p1, p2, p3).exclude(Set(""))
  }

  def nextId(st: St): str =
    if (not(st.exists.contains("P1"))) "P1" else if (not(st.exists.contains("P2"))) "P2"
    else if (not(st.exists.contains("P3"))) "P3" else if (not(st.exists.contains("P4"))) "P4" else ""

  // The lock after a commit: a function of the definition and the previous lock only.
  def nextLock(defined: bool, defKey: str, lock: str -> str): str -> str =
    KEYS.mapBy(k =>
      if (defined and k == defKey) "managed"
      else if (lock.get(k) != "") "removing"
      else "")

  action init = {
    nondet t = Set(0, 1).oneOf()
    nondet a = Set(true, false).oneOf()
    nondet k = KEYS.oneOf()
    s' = {
      exists: Set(), terms: Map(), key: Map(), previous: Map(), active: Set(),
      defined: true, defKey: k, defTerms: t, defActive: a,
      lock: nextLock(true, k, KEYS.mapBy(x => "")), released: Set(),
      phase: "idle", target: "", chain: Set(), toArchive: Set(), runs: 0, failed: false,
      lastRan: false, lastClean: false,
    }
  }

  // A developer changes terms, active, the lookup key, or removes the slot, and runs synth.
  action commit = {
    nondet t = Set(0, 1, 2).oneOf()
    nondet a = Set(true, false).oneOf()
    nondet k = KEYS.oneOf()
    nondet remove = Set(true, false).oneOf()
    all {
      s.phase == "idle",
      s.defined,
      s' = { ...s, defTerms: t, defActive: a, defKey: k, defined: not(remove),
        lock: nextLock(not(remove), k, s.lock), lastRan: false },
    }
  }

  // A person drops a "removing" entry: its prices are no longer pricectl's.
  action release = {
    nondet k = KEYS.oneOf()
    all {
      s.phase == "idle",
      s.lock.get(k) == "removing",
      s' = { ...s, lock: s.lock.put(k, ""), released: s.released.union(reachKey(s, k)), lastRan: false },
    }
  }

  action deployStart = all {
    s.phase == "idle",
    s.runs < MAX_RUNS,
    val h = if (s.defined) holderOf(s, s.defKey) else ""
    val reuse = h != "" and s.terms.get(h) == s.defTerms
    val removing = KEYS.filter(k => s.lock.get(k) == "removing")
    // plan adopts the prices of a claimed key, including ones released earlier.
    val adopted = if (s.defined) reachKey(s, s.defKey) else Set()
    s' = { ...s, runs: s.runs + 1, failed: false,
      chain: adopted,
      released: s.released.exclude(adopted),
      toArchive: removing.fold(Set(), (acc, k) => acc.union(reachKey(s, k))),
      phase: if (not(s.defined)) "archive" else if (reuse) "activate" else "create",
      target: if (reuse) h else "" },
  }

  // Create the definition's price; if its key has a holder, the key is transferred.
  action deployCreate = {
    nondet outcome = Set("ok", "failedNotCreated", "failedButCreated").oneOf()
    val id = nextId(s)
    val h = holderOf(s, s.defKey)
    all {
      s.phase == "create",
      id != "",
      if (outcome == "failedNotCreated")
        s' = { ...s, phase: "idle", failed: true, lastRan: true, lastClean: false }
      else
        s' = { ...s,
          exists: s.exists.union(Set(id)),
          terms: s.terms.put(id, s.defTerms),
          key: (if (h == "") s.key else s.key.put(h, "")).put(id, s.defKey),
          previous: s.previous.put(id, h),
          active: if (s.defActive) s.active.union(Set(id)) else s.active,
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

  // Archive one price on sale per call: other versions of the defined key, and every
  // version of a removing key.
  action deployArchive = {
    nondet p = Set("P1", "P2", "P3", "P4").oneOf()
    nondet fails = Set(true, false).oneOf()
    val others = s.chain.exclude(Set(s.target)).union(s.toArchive).intersect(s.active)
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

  action step = any { commit, release, deployStart, deployCreate, deployActivate, deployArchive, stutter }

  // ---------- Properties ----------

  def tracked(st: St, p: str): bool =
    KEYS.exists(k => st.lock.get(k) != "" and reachKey(st, k).contains(p))

  // Every price on sale is reached from a key in the lock, unless a person released it.
  val noUntrackedPriceOnSale: bool =
    s.active.forall(p => s.released.contains(p) or tracked(s, p))

  // A key has at most one holder (Stripe's rule; the model must respect it).
  val oneHolderPerKey: bool =
    KEYS.forall(k => s.exists.filter(p => s.key.get(p) == k).size() <= 1)

  // A deploy that finished without failures leaves exactly the definition on sale,
  // apart from prices a person released.
  val cleanDeployConverges: bool =
    not(s.phase == "idle" and s.lastRan and s.lastClean) or
      (val onSale = s.active.exclude(s.released)
       if (not(s.defined)) onSale.size() == 0
       else val h = holderOf(s, s.defKey)
         all {
           h != "",
           s.terms.get(h) == s.defTerms,
           onSale == (if (s.defActive) Set(h) else Set()),
         })

  // Witnesses: these must be violated.
  // The key changed: the old key's price is archived, the new key's price is on sale.
  val witnessKeyChanged: bool = not(
    s.lastClean and s.lock.get("K1") == "removing" and s.lock.get("K2") == "managed"
    and s.exists.exists(p => s.key.get(p) == "K1" and not(s.active.contains(p)))
    and s.exists.exists(p => s.key.get(p) == "K2" and s.active.contains(p)))
  // A key changed and changed back: its old price is reused, not recreated.
  // (P1 was created first, so its key was defined, then another key, then P1's key again.)
  val witnessKeyChangedBack: bool = not(
    s.lastClean and s.defined and holderOf(s, s.defKey) == "P1" and s.active.contains("P1")
    and holderOf(s, if (s.defKey == "K1") "K2" else "K1") == "P2"
    and s.lock.get(if (s.defKey == "K1") "K2" else "K1") == "removing")
  // A released price stays on sale after a clean deploy.
  val witnessReleasedStaysOnSale: bool = not(s.lastClean and s.active.intersect(s.released).size() > 0)
}
