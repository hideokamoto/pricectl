// pricectl: meters without a state file (v3). Meters have no metadata, so the stack
// records the event names of its meters in pricectl.lock.json, committed to Git.
//
// The lock is a function of the previous lock and the definition only (no Stripe reads):
//   defined event name                    -> "managed"
//   previously managed/removing, removed  -> "removing" (kept until a person drops it)
// synth/plan/deploy update the lock locally; in CI, plan/deploy refuse a lock that is not
// up to date with the definition. Deploys of one stack are serialized (one CI job at a time).
// One event name E is modeled. Stripe allows one active meter per event name (verified).
module meter_lock_v3 {
  val OUR_IDS: Set[str] = Set("M1", "M2", "M3")
  val FOREIGN: str = "F"

  type St = {
    defined: bool,           // the committed definition has a meter with event name E
    lock: str,               // committed lock entry for E: "none" | "managed" | "removing"
    exists: Set[str],
    active: Set[str],
    phase: str,              // CI deploy: "idle" | "ensure" | "remove" | "done"
    deployFailed: bool,
    deployInterfered: bool,  // something outside pricectl changed Stripe during this deploy
    // history
    adopted: Set[str],                // meters with E found and used by a deploy
    released: bool,                   // a person dropped the "removing" entry
    foreignClaimed: bool,   // the foreign meter was active at some point while the lock listed E
    foreignDeactivated: bool,
    lastDeployClean: bool,
    lastDeployRan: bool,
  }

  var s: St

  action init = all {
    s' = {
      defined: false, lock: "none", exists: Set(), active: Set(), phase: "idle",
      deployFailed: false, deployInterfered: false, adopted: Set(), released: false,
      foreignClaimed: false, foreignDeactivated: false,
      lastDeployClean: false, lastDeployRan: false,
    }
  }

  // The lock synth/plan write for a definition.
  pure def nextLock(prev: str, defined: bool): str =
    if (defined) "managed" else if (prev == "managed" or prev == "removing") "removing" else "none"

  def upToDate(st: St): bool = st.lock == nextLock(st.lock, st.defined)

  def pickNewId(st: St): str =
    if (not(st.exists.contains("M1"))) "M1" else if (not(st.exists.contains("M2"))) "M2"
    else if (not(st.exists.contains("M3"))) "M3" else ""

  // A developer changes the definition and commits the lock synth wrote.
  action commitWithLock = all {
    s.phase == "idle",
    val d = not(s.defined)
    val l = nextLock(s.lock, d)
    s' = { ...s, defined: d, lock: l, lastDeployRan: false,
      foreignClaimed: s.foreignClaimed or (l != "none" and s.active.contains(FOREIGN)) },
  }

  // A developer changes the definition but forgets to commit the lock.
  action commitWithoutLock = all {
    s.phase == "idle",
    s' = { ...s, defined: not(s.defined), lastDeployRan: false },
  }

  // A person drops the "removing" entry by hand, releasing the event name.
  action releaseEntry = all {
    s.phase == "idle",
    not(s.defined),
    s.lock == "removing",
    s' = { ...s, lock: "none", released: true, lastDeployRan: false },
  }

  // Someone creates a meter with E in the Dashboard (Stripe: only if none is active).
  action foreignCreate = all {
    not(s.exists.contains(FOREIGN)),
    s.active.size() == 0,
    s' = { ...s,
      exists: s.exists.union(Set(FOREIGN)),
      active: s.active.union(Set(FOREIGN)),
      foreignClaimed: s.foreignClaimed or s.lock != "none",
      deployInterfered: s.deployInterfered or s.phase != "idle",
      lastDeployRan: false,
    },
  }

  // CI deploy, step 1: refuse a lock that is not up to date.
  action deployStart = all {
    s.phase == "idle",
    if (upToDate(s))
      s' = { ...s, phase: "ensure", deployFailed: false, deployInterfered: false }
    else
      s' = { ...s, lastDeployRan: false },
  }

  // Step 2: a defined meter is found by event name, or created.
  action deployEnsure = {
    nondet outcome = Set("ok", "failedNotCreated", "failedButCreated").oneOf()
    val id = pickNewId(s)
    all {
      s.phase == "ensure",
      if (not(s.defined))
        s' = { ...s, phase: "remove" }
      else if (s.active.size() > 0)
        s' = { ...s, adopted: s.adopted.union(s.active), phase: "remove" }
      else if (id == "")
        s' = { ...s, phase: "done", deployFailed: true }
      else if (outcome == "failedNotCreated")
        s' = { ...s, phase: "done", deployFailed: true }
      else
        s' = { ...s,
          exists: s.exists.union(Set(id)),
          active: s.active.union(Set(id)),
          phase: if (outcome == "ok") "remove" else "done",
          deployFailed: outcome != "ok",
        },
    }
  }

  // Step 3: a "removing" entry deactivates the active meter with E (one call, may fail).
  action deployRemove = {
    nondet fails = Set(true, false).oneOf()
    all {
      s.phase == "remove",
      if (s.lock != "removing" or s.active.size() == 0)
        s' = { ...s, phase: "done" }
      else if (fails)
        s' = { ...s, phase: "done", deployFailed: true }
      else
        s' = { ...s,
          active: Set(),
          foreignDeactivated: s.foreignDeactivated or s.active.contains(FOREIGN),
          phase: "done",
        },
    }
  }

  action deployEnd = all {
    s.phase == "done",
    s' = { ...s, phase: "idle", lastDeployRan: true, lastDeployClean: not(s.deployFailed) and not(s.deployInterfered) },
  }

  action step = any {
    commitWithLock, commitWithoutLock, releaseEntry, foreignCreate,
    deployStart, deployEnsure, deployRemove, deployEnd,
  }

  // ---------- Properties ----------

  // Stripe: at most one active meter per event name.
  val oneActiveMeter: bool = s.active.size() <= 1

  // No floating meter: an active meter pricectl created is tracked by the definition or the
  // lock, unless a person released the event name.
  val noFloatingMeter: bool =
    s.released or s.active.intersect(OUR_IDS).size() == 0 or s.defined or s.lock != "none"

  // The lock claims the event name, not one meter: pricectl deactivates a meter created in
  // the Dashboard only when that meter was active at some point while the lock listed E.
  val foreignDeactivatedOnlyWhenClaimed: bool =
    not(s.foreignDeactivated) or s.foreignClaimed

  // A deploy without failures and without outside changes during it leaves exactly what the
  // definition says.
  val cleanDeployConverges: bool =
    not(s.phase == "idle" and s.lastDeployRan and s.lastDeployClean) or
      (if (s.defined) s.active.size() == 1 else (s.lock == "removing" implies s.active.size() == 0))

  // Witnesses: these must be violated.
  val witnessNoRefusal: bool = not(s.phase == "idle" and not(upToDate(s)) and not(s.lastDeployRan))
  val witnessNoReaddAfterRemoval: bool = not(s.defined and s.exists.intersect(OUR_IDS).size() >= 2 and s.active.size() == 1)
  val witnessNoForeignTakenOver: bool = not(s.foreignDeactivated and not(s.adopted.contains(FOREIGN)))
  val witnessNoAdoption: bool = s.adopted.size() == 0
}
