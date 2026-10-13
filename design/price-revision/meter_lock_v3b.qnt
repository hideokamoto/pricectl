// pricectl: meters and pricectl.lock.json (v3), two event names and two CI deploys.
// A removal deactivates only the meters plan saw (by Stripe ID), as in plan/apply.
//
// Extends meter_lock_v3.qnt: event names E1 and E2, and deploys D1, D2 that each use the
// commit they started from. `concurrent` (chosen at init) allows both deploys to run at the
// same time; otherwise one deploy runs at a time. Meter ids: E1a, E1b, E2a, E2b (created by
// pricectl), E1f (created in the Dashboard with E1). Stripe allows one active meter per
// event name (verified in test mode).
module meter_lock_v3b {
  val NAMES: Set[str] = Set("E1", "E2")
  val OURS: str -> Set[str] = Map("E1" -> Set("E1a", "E1b"), "E2" -> Set("E2a", "E2b"))
  val FOREIGN: str = "E1f"
  val DEPLOYS: Set[str] = Set("D1", "D2")
  def nameOf(id: str): str = if (id.in(Set("E1a", "E1b", "E1f"))) "E1" else "E2"
  val ENSURE: str -> str = Map("E1" -> "ensure:E1", "E2" -> "ensure:E2")
  val REMOVE: str -> str = Map("E1" -> "remove:E1", "E2" -> "remove:E2")
  val FIRST_ID: str -> str = Map("E1" -> "E1a", "E2" -> "E2a")
  val SECOND_ID: str -> str = Map("E1" -> "E1b", "E2" -> "E2b")

  type Deploy = {
    phase: str,                // "idle" | "run"
    seq: int,                  // commit it deploys
    defined: Set[str],
    lock: str -> str,
    todo: Set[str],            // "ensure:E1", "remove:E2", ...
    planned: Set[str],         // meters seen at plan time that a removal may deactivate
    failed: bool,
    sawOutsideChange: bool,    // a Dashboard change happened while it ran
    sawOtherDeploy: bool,      // another deploy was running at some point while it ran
  }

  type St = {
    concurrent: bool,
    seq: int,                  // latest commit
    defined: Set[str],
    lock: str -> str,          // "none" | "managed" | "removing"
    released: Set[str],
    exists: Set[str],
    active: Set[str],
    deploys: str -> Deploy,
    foreignClaimed: bool,
    foreignDeactivated: bool,
    // a deploy of the latest commit finished without failures, and no commit or Dashboard
    // change happened since (other pricectl deploys may still have acted)
    latestOk: bool,
    // the same, and that deploy ran alone (no other deploy at any point while it ran)
    latestSoloOk: bool,
    everOverlapped: bool,      // two deploys ran at the same time at some point
  }

  var s: St

  pure def nextLock(prev: str, defined: bool): str =
    if (defined) "managed" else if (prev == "managed" or prev == "removing") "removing" else "none"

  def idleDeploy: Deploy = {
    phase: "idle", seq: 0, defined: Set(), lock: NAMES.mapBy(n => "none"),
    todo: Set(), planned: Set(), failed: false, sawOutsideChange: false, sawOtherDeploy: false,
  }

  action init = {
    nondet c = Set(true, false).oneOf()
    s' = {
      concurrent: c, seq: 0, defined: Set(), lock: NAMES.mapBy(n => "none"), released: Set(),
      exists: Set(), active: Set(), deploys: DEPLOYS.mapBy(d => idleDeploy),
      foreignClaimed: false, foreignDeactivated: false,
      latestOk: false, latestSoloOk: false, everOverlapped: false,
    }
  }

  def running(st: St): Set[str] = DEPLOYS.filter(d => st.deploys.get(d).phase == "run")
  def activeWith(st: St, n: str): Set[str] = st.active.filter(m => nameOf(m) == n)

  // A developer toggles one event name in the definition, with or without committing the lock.
  action commit = {
    nondet n = NAMES.oneOf()
    nondet withLock = Set(true, false).oneOf()
    val d = if (s.defined.contains(n)) s.defined.exclude(Set(n)) else s.defined.union(Set(n))
    val l = if (withLock) NAMES.mapBy(x => nextLock(s.lock.get(x), d.contains(x))) else s.lock
    s' = { ...s, seq: s.seq + 1, defined: d, lock: l, latestOk: false, latestSoloOk: false,
      foreignClaimed: s.foreignClaimed or (l.get("E1") != "none" and s.active.contains(FOREIGN)) }
  }

  // A person drops a "removing" entry, releasing the event name.
  action release = {
    nondet n = NAMES.oneOf()
    all {
      not(s.defined.contains(n)),
      s.lock.get(n) == "removing",
      s' = { ...s, seq: s.seq + 1, lock: s.lock.set(n, "none"), released: s.released.union(Set(n)),
        latestOk: false, latestSoloOk: false },
    }
  }

  action foreignCreate = all {
    not(s.exists.contains(FOREIGN)),
    activeWith(s, "E1").size() == 0,
    s' = { ...s,
      exists: s.exists.union(Set(FOREIGN)), active: s.active.union(Set(FOREIGN)),
      foreignClaimed: s.foreignClaimed or s.lock.get("E1") != "none",
      deploys: s.deploys.keys().mapBy(d => { ...s.deploys.get(d),
        sawOutsideChange: s.deploys.get(d).sawOutsideChange or s.deploys.get(d).phase == "run" }),
      latestOk: false, latestSoloOk: false,
    },
  }

  // A CI deploy starts from the latest commit; it refuses an out-of-date lock.
  action deployStart = {
    nondet d = DEPLOYS.oneOf()
    val upToDate = NAMES.forall(n => s.lock.get(n) == nextLock(s.lock.get(n), s.defined.contains(n)))
    val todo = NAMES.filter(n => s.defined.contains(n)).map(n => ENSURE.get(n))
      .union(NAMES.filter(n => s.lock.get(n) == "removing").map(n => REMOVE.get(n)))
    all {
      s.deploys.get(d).phase == "idle",
      s.concurrent or running(s).size() == 0,
      upToDate,
      s' = { ...s, everOverlapped: s.everOverlapped or running(s).size() > 0,
        deploys: s.deploys.keys().mapBy(x => if (x == d) {
        phase: "run", seq: s.seq, defined: s.defined, lock: s.lock, todo: todo,
        planned: s.active.filter(m => s.lock.get(nameOf(m)) == "removing"),
        failed: false, sawOutsideChange: false, sawOtherDeploy: running(s).size() > 0,
      } else { ...s.deploys.get(x), sawOtherDeploy: s.deploys.get(x).sawOtherDeploy or s.deploys.get(x).phase == "run" }) },
    }
  }

  // One step of a deploy: ensure a defined meter, or deactivate a removing one. May fail.
  action deployStep = {
    nondet d = DEPLOYS.oneOf()
    nondet task = Set("ensure:E1", "ensure:E2", "remove:E1", "remove:E2").oneOf()
    nondet outcome = Set("ok", "failedNotCreated", "failedButCreated").oneOf()
    val dp = s.deploys.get(d)
    val n = if (task.in(Set("ensure:E1", "remove:E1"))) "E1" else "E2"
    val isEnsure = task.in(Set("ensure:E1", "ensure:E2"))
    val act = activeWith(s, n)
    // a removal deactivates only the meter plan saw, never one created after the plan
    val toDeactivate = act.intersect(dp.planned)
    val free = OURS.get(n).exclude(s.exists)
    val newId = if (free.contains(FIRST_ID.get(n))) FIRST_ID.get(n)
      else if (free.contains(SECOND_ID.get(n))) SECOND_ID.get(n) else ""
    all {
      dp.phase == "run",
      dp.todo.contains(task),
      val rest = dp.todo.exclude(Set(task))
      if (isEnsure)
        if (act.size() > 0)
          s' = { ...s, deploys: s.deploys.set(d, { ...dp, todo: rest }) }
        else if (newId == "" or outcome == "failedNotCreated")
          s' = { ...s, deploys: s.deploys.set(d, { ...dp, todo: Set(), failed: true }) }
        else
          s' = { ...s,
            exists: s.exists.union(Set(newId)), active: s.active.union(Set(newId)),
            deploys: s.deploys.set(d, { ...dp,
              todo: if (outcome == "ok") rest else Set(), failed: outcome != "ok" }),
          }
      else
        if (toDeactivate.size() == 0)
          s' = { ...s, deploys: s.deploys.set(d, { ...dp, todo: rest }) }
        else if (outcome != "ok")
          s' = { ...s, deploys: s.deploys.set(d, { ...dp, todo: Set(), failed: true }) }
        else
          s' = { ...s,
            active: s.active.exclude(toDeactivate),
            foreignDeactivated: s.foreignDeactivated or toDeactivate.contains(FOREIGN),
            deploys: s.deploys.set(d, { ...dp, todo: rest }),
          },
    }
  }

  action deployEnd = {
    nondet d = DEPLOYS.oneOf()
    val dp = s.deploys.get(d)
    all {
      dp.phase == "run",
      dp.todo.size() == 0,
      s' = { ...s,
        deploys: s.deploys.set(d, idleDeploy),
        latestOk: s.latestOk or (dp.seq == s.seq and not(dp.failed) and not(dp.sawOutsideChange)),
        latestSoloOk: s.latestSoloOk or (dp.seq == s.seq and not(dp.failed) and not(dp.sawOutsideChange) and not(dp.sawOtherDeploy)),
      },
    }
  }

  action step = any { commit, release, foreignCreate, deployStart, deployStep, deployEnd }

  // ---------- Properties ----------

  val oneActivePerName: bool = NAMES.forall(n => activeWith(s, n).size() <= 1)

  val noFloatingMeter: bool = NAMES.forall(n =>
    s.released.contains(n) or s.active.intersect(OURS.get(n)).size() == 0
      or s.defined.contains(n) or s.lock.get(n) != "none")

  val foreignDeactivatedOnlyWhenClaimed: bool = not(s.foreignDeactivated) or s.foreignClaimed

  // When no deploy runs and a deploy of the latest commit finished without failures and
  // without Dashboard changes while it ran, with no commit or Dashboard change since, the
  // meters are as defined (other pricectl deploys may have run in between).
  val quiescentConverges: bool =
    not(running(s).size() == 0 and s.latestOk) or
      NAMES.forall(n =>
        if (s.defined.contains(n)) activeWith(s, n).size() == 1
        else (s.lock.get(n) == "removing" implies activeWith(s, n).size() == 0))

  // Witnesses: these must be violated.
  val witnessNoConcurrentDeploys: bool = running(s).size() < 2
  val witnessNoBothNamesManaged: bool = not(NAMES.forall(n => s.active.intersect(OURS.get(n)).size() == 1))

  // ---------- Split by whether deploys may run at the same time ----------
  val serialNoFloating: bool = s.concurrent or noFloatingMeter
  val serialForeignOnlyWhenClaimed: bool = s.concurrent or foreignDeactivatedOnlyWhenClaimed
  val serialConverges: bool = s.concurrent or quiescentConverges
  val concurrentNoFloating: bool = not(s.concurrent) or noFloatingMeter
  val concurrentForeignOnlyWhenClaimed: bool = not(s.concurrent) or foreignDeactivatedOnlyWhenClaimed
  val concurrentConverges: bool = not(s.concurrent) or quiescentConverges

  // After deploys ran at the same time, a later deploy of the latest commit that ran alone
  // and without failures ends as defined: concurrent deploys leave things wrong only until then.
  val soloDeployRecovers: bool =
    not(running(s).size() == 0 and s.latestSoloOk) or
      NAMES.forall(n =>
        if (s.defined.contains(n)) activeWith(s, n).size() == 1
        else (s.lock.get(n) == "removing" implies activeWith(s, n).size() == 0))

  // A lone deploy of the latest commit finishes after two deploys overlapped.
  val witnessNoSoloAfterConcurrent: bool = not(s.everOverlapped and s.latestSoloOk)
}
