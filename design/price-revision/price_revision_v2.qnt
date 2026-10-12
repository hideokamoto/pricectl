// pricectl: price revision after the decisions in DECISIONS.md (v2), over several deploys.
//
// One slot whose terms changed. OLD is its current version; N1, N2 are the only possible
// new versions. Every price is tagged with the slot (metadata pricectl_id). Each deploy:
//   plan:  reuse a price with the new terms if one exists (a stray), otherwise create one
//   steps: activate the target, move the lookup key to it, fix the default price
//          (move it to the target, or unset it when the target is not on sale),
//          archive the slot's other prices one by one, deactivate the target if the
//          definition sets active: false, then save the state file.
// Every Stripe call can fail transiently; a create can fail after Stripe created the
// price (timeout). After a failure, best-effort undo leaves any subset of its effects.
// Stripe rejects: an inactive default price; archiving the default price (verified in
// test mode). Someone may change the default price in the Dashboard during a deploy.
module price_revision_v2 {
  val NEW_IDS: Set[str] = Set("N1", "N2")
  val ALL_IDS: Set[str] = Set("OLD", "N1", "N2")
  val MAX_RUNS: int = 3

  type St = {
    exists: Set[str],
    active: Set[str],
    keyHolder: str,
    defaultPrice: str,
    current: str,
    // scenario
    desiredActive: bool,
    hasKey: bool,
    dashboardEnabled: bool,
    // the deploy in progress
    phase: str,
    target: str,
    runs: int,
    runTransient: bool,
    runRejected: bool,
    runDashboard: bool,
    defaultAtStart: str,
    // the last finished deploy
    lastOk: bool,
    lastTransient: bool,
    lastRejected: bool,
    lastDashboard: bool,
    lastDefaultAtStart: str,
    // history, for the witnesses below
    everFailed: bool,
    reusedStray: bool,
  }

  var s: St

  action init = {
    nondet da = Set(true, false).oneOf()
    nondet hk = Set(true, false).oneOf()
    nondet od = Set(true, false).oneOf()
    nondet de = Set(true, false).oneOf()
    s' = {
      exists: Set("OLD"),
      active: Set("OLD"),
      keyHolder: if (hk) "OLD" else "",
      defaultPrice: if (od) "OLD" else "",
      current: "OLD",
      desiredActive: da,
      hasKey: hk,
      dashboardEnabled: de,
      phase: "idle",
      target: "",
      runs: 0,
      runTransient: false,
      runRejected: false,
      runDashboard: false,
      defaultAtStart: "",
      lastOk: false,
      lastTransient: false,
      lastRejected: false,
      lastDashboard: false,
      lastDefaultAtStart: "",
      everFailed: false,
      reusedStray: false,
    }
  }

  // Prices with the new terms that already exist (strays, or the current version).
  def newVersions(st: St): Set[str] = st.exists.intersect(NEW_IDS)

  def pick(xs: Set[str]): str =
    if (xs.contains("N1")) "N1" else if (xs.contains("N2")) "N2" else if (xs.contains("OLD")) "OLD" else ""

  // plan
  action startRun = all {
    s.phase == "idle",
    s.runs < MAX_RUNS,
    val t = pick(newVersions(s))
    s' = { ...s,
      phase: if (t == "") "create" else "activate",
      target: t,
      runs: s.runs + 1,
      runTransient: false,
      runRejected: false,
      runDashboard: false,
      defaultAtStart: s.defaultPrice,
      reusedStray: s.reusedStray or (t != "" and s.everFailed),
    },
  }

  // A transient failure ends the deploy; best-effort undo is folded into `undo`.
  action failTransient = all {
    s.phase.in(Set("create", "activate", "key", "default", "archive", "deactivate")),
    s' = { ...s, phase: "undo", runTransient: true },
  }

  action create = {
    nondet outcome = Set("ok", "createdButFailed").oneOf()
    val id = pick(NEW_IDS.exclude(s.exists))
    all {
      s.phase == "create",
      id != "",
      s' = { ...s,
        exists: s.exists.union(Set(id)),
        active: if (s.desiredActive) s.active.union(Set(id)) else s.active,
        keyHolder: if (s.hasKey) id else s.keyHolder,
        target: id,
        phase: if (outcome == "ok") "activate" else "undo",
        runTransient: s.runTransient or outcome != "ok",
      },
    }
  }

  action activate = all {
    s.phase == "activate",
    s' = { ...s,
      active: if (s.desiredActive) s.active.union(Set(s.target)) else s.active,
      phase: "key",
    },
  }

  action moveKey = all {
    s.phase == "key",
    s' = { ...s, keyHolder: if (s.hasKey) s.target else s.keyHolder, phase: "default" },
  }

  // Follow the default price: move it to the target, or unset it when the target is not on sale.
  action fixDefault = all {
    s.phase == "default",
    if (s.defaultPrice == "" or (s.defaultPrice == s.target and s.desiredActive))
      s' = { ...s, phase: "archive" }
    else if (s.desiredActive)
      if (s.active.contains(s.target))
        s' = { ...s, defaultPrice: s.target, phase: "archive" }
      else
        s' = { ...s, phase: "undo", runRejected: true }
    else
      s' = { ...s, defaultPrice: "", phase: "archive" },
  }

  // Archive the slot's other prices that are on sale, one per call.
  action archiveOther = {
    nondet p = ALL_IDS.oneOf()
    all {
      s.phase == "archive",
      val others = s.active.exclude(Set(s.target))
      if (others.size() == 0)
        s' = { ...s, phase: "deactivate" }
      else all {
        others.contains(p),
        if (s.defaultPrice == p)
          s' = { ...s, phase: "undo", runRejected: true }
        else
          s' = { ...s, active: s.active.exclude(Set(p)) },
      },
    }
  }

  action deactivateTarget = all {
    s.phase == "deactivate",
    if (s.desiredActive or not(s.active.contains(s.target)))
      s' = { ...s, phase: "commit" }
    else if (s.defaultPrice == s.target)
      s' = { ...s, phase: "undo", runRejected: true }
    else
      s' = { ...s, active: s.active.exclude(Set(s.target)), phase: "commit" },
  }

  action commit = all {
    s.phase == "commit",
    s' = { ...s,
      current: s.target,
      phase: "idle",
      lastOk: true,
      lastTransient: s.runTransient,
      lastRejected: s.runRejected,
      lastDashboard: s.runDashboard,
      lastDefaultAtStart: s.defaultAtStart,
    },
  }

  // Best-effort undo: any subset of {default back to current, key back to current, archive
  // the target} takes effect, each only when Stripe accepts it.
  action undo = {
    nondet backDefault = Set(true, false).oneOf()
    nondet backKey = Set(true, false).oneOf()
    nondet archiveTarget = Set(true, false).oneOf()
    val canBackDefault = backDefault and s.defaultPrice != "" and s.defaultPrice != s.current
      and s.active.contains(s.current)
    val d2 = if (canBackDefault) s.current else s.defaultPrice
    val k2 = if (backKey and s.hasKey and s.exists.contains(s.current)) s.current else s.keyHolder
    val a2 = if (archiveTarget and s.target != "" and s.target != s.current and d2 != s.target)
      s.active.exclude(Set(s.target)) else s.active
    all {
      s.phase == "undo",
      s' = { ...s,
        defaultPrice: d2,
        keyHolder: k2,
        active: a2,
        phase: "idle",
        everFailed: true,
        lastOk: false,
        lastTransient: s.runTransient,
        lastRejected: s.runRejected,
        lastDashboard: s.runDashboard,
        lastDefaultAtStart: s.defaultAtStart,
      },
    }
  }

  action dashboardSetsDefault = {
    nondet p = ALL_IDS.oneOf()
    all {
      s.dashboardEnabled,
      s.phase != "idle",
      s.active.contains(p),
      s' = { ...s, defaultPrice: p, runDashboard: true },
    }
  }

  action stutter = all {
    s.phase == "idle",
    s.runs == MAX_RUNS,
    s' = s,
  }

  action step = any {
    startRun, failTransient, create, activate, moveKey, fixDefault,
    archiveOther, deactivateTarget, commit, undo, dashboardSetsDefault, stutter,
  }

  // ---------- Properties ----------

  // Sanity: Stripe never ends up with an inactive default price.
  val defaultIsActive: bool = s.defaultPrice == "" or s.active.contains(s.defaultPrice)

  // Retries reuse the stray instead of creating another price with the new terms.
  val atMostOneNewVersion: bool = newVersions(s).size() <= 1

  // A deploy without transient errors and without Dashboard changes ends with the slot
  // exactly as defined, whatever earlier failed deploys left behind.
  val cleanDeployConverges: bool =
    not(s.phase == "idle" and s.runs > 0 and not(s.lastTransient) and not(s.lastDashboard)) or all {
      s.lastOk,
      s.current.in(NEW_IDS),
      s.active.intersect(ALL_IDS) == (if (s.desiredActive) Set(s.current) else Set()),
      s.hasKey implies s.keyHolder == s.current,
      (s.desiredActive and s.lastDefaultAtStart != "") implies s.defaultPrice == s.current,
      not(s.desiredActive) implies s.defaultPrice == "",
    }

  // Stripe never rejects a step of a deploy that nothing interfered with.
  val rejectedOnlyOnInterference: bool =
    not(s.lastRejected) or s.lastTransient or s.lastDashboard

  // ---------- Witnesses: these must be violated, showing the scenarios are reachable ----------
  val witnessNoSuccess: bool = not(s.lastOk)
  val witnessNoRecoveryAfterFailure: bool = not(s.everFailed and s.lastOk)
  val witnessNoStrayReuse: bool = not(s.reusedStray and s.lastOk)
  val witnessNoDashboardRace: bool = not(s.lastDashboard and not(s.lastOk))
}
