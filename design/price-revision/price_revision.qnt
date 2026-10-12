// pricectl: To-be procedure for a price revision (terms changed), step by step.
//
// One product, the slot's current price OLD, the replacement NEW, one lookup key.
// To-be procedure:
//   1. create NEW with transfer_lookup_key (the key moves to NEW atomically)
//   2. if OLD is the product's default price, make NEW the default price
//   3. archive OLD
// When step 2 or 3 fails, undo is best effort, each step on its own:
//   U1. make OLD the default price again (if it was moved)
//   U2. give the lookup key back to OLD (if it was moved)
//   U3. archive NEW
// Every Stripe call can fail with a transient error (network, 5xx). Stripe also
// rejects calls by its rules:
//   - the default price must be active (docs: "The default price must be an active price")
//   - so a default price cannot be archived (observed in issue #44)
// Someone may change the default price in the Dashboard while deploy runs.
module price_revision {
  type Phase = str

  var phase: Phase
  var newExists: bool
  var active: Set[str]
  var keyHolder: str
  var defaultPrice: str
  var movedDefault: bool
  var keyMoved: bool
  // scenario, fixed at init
  var desiredActive: bool
  var hasKey: bool
  var wasDefault: bool
  var dashboardEnabled: bool
  // history
  var transientFailure: bool
  var rejectedByStripe: bool
  var dashboardTouched: bool
  // a best-effort undo call failed
  var undoFailed: bool

  val running: bool = not(phase.in(Set("done", "failed")))

  action keepScenario = all {
    desiredActive' = desiredActive,
    hasKey' = hasKey,
    wasDefault' = wasDefault,
    dashboardEnabled' = dashboardEnabled,
  }

  action init = {
    nondet da = Set(true, false).oneOf()
    nondet hk = Set(true, false).oneOf()
    nondet od = Set(true, false).oneOf()
    nondet de = Set(true, false).oneOf()
    all {
      desiredActive' = da,
      hasKey' = hk,
      wasDefault' = od,
      dashboardEnabled' = de,
      phase' = "start",
      newExists' = false,
      active' = Set("OLD"),
      keyHolder' = if (hk) "OLD" else "",
      defaultPrice' = if (od) "OLD" else "",
      movedDefault' = false,
      keyMoved' = false,
      transientFailure' = false,
      rejectedByStripe' = false,
      dashboardTouched' = false,
      undoFailed' = false,
    }
  }

  // 1. create NEW with transfer_lookup_key
  action createNew = {
    nondet callFails = Set(true, false).oneOf()
    all {
      phase == "start",
      keepScenario,
      undoFailed' = undoFailed,
      defaultPrice' = defaultPrice,
      movedDefault' = movedDefault,
      rejectedByStripe' = rejectedByStripe,
      dashboardTouched' = dashboardTouched,
      if (callFails) all {
        phase' = "failed",
        transientFailure' = true,
        newExists' = newExists,
        active' = active,
        keyHolder' = keyHolder,
        keyMoved' = keyMoved,
      } else all {
        phase' = "created",
        transientFailure' = transientFailure,
        newExists' = true,
        active' = if (desiredActive) active.union(Set("NEW")) else active,
        keyHolder' = if (hasKey) "NEW" else keyHolder,
        keyMoved' = hasKey,
      },
    }
  }

  // 2. move the default price from OLD to NEW
  action moveDefault = {
    nondet callFails = Set(true, false).oneOf()
    all {
      phase == "created",
      keepScenario,
      undoFailed' = undoFailed,
      newExists' = newExists,
      active' = active,
      keyHolder' = keyHolder,
      keyMoved' = keyMoved,
      dashboardTouched' = dashboardTouched,
      if (defaultPrice != "OLD") all {
        phase' = "defaultDone",
        defaultPrice' = defaultPrice,
        movedDefault' = movedDefault,
        transientFailure' = transientFailure,
        rejectedByStripe' = rejectedByStripe,
      } else if (not(active.contains("NEW"))) all {
        // Stripe: the default price must be active
        phase' = "undo1",
        defaultPrice' = defaultPrice,
        movedDefault' = movedDefault,
        transientFailure' = transientFailure,
        rejectedByStripe' = true,
      } else if (callFails) all {
        phase' = "undo1",
        defaultPrice' = defaultPrice,
        movedDefault' = movedDefault,
        transientFailure' = true,
        rejectedByStripe' = rejectedByStripe,
      } else all {
        phase' = "defaultDone",
        defaultPrice' = "NEW",
        movedDefault' = true,
        transientFailure' = transientFailure,
        rejectedByStripe' = rejectedByStripe,
      },
    }
  }

  // 3. archive OLD
  action archiveOld = {
    nondet callFails = Set(true, false).oneOf()
    all {
      phase == "defaultDone",
      keepScenario,
      undoFailed' = undoFailed,
      newExists' = newExists,
      keyHolder' = keyHolder,
      keyMoved' = keyMoved,
      defaultPrice' = defaultPrice,
      movedDefault' = movedDefault,
      dashboardTouched' = dashboardTouched,
      if (defaultPrice == "OLD") all {
        // Stripe: a default price cannot be archived
        phase' = "undo1",
        active' = active,
        transientFailure' = transientFailure,
        rejectedByStripe' = true,
      } else if (callFails) all {
        phase' = "undo1",
        active' = active,
        transientFailure' = true,
        rejectedByStripe' = rejectedByStripe,
      } else all {
        phase' = "done",
        active' = active.exclude(Set("OLD")),
        transientFailure' = transientFailure,
        rejectedByStripe' = rejectedByStripe,
      },
    }
  }

  // U1. make OLD the default price again
  action undoDefault = {
    nondet callFails = Set(true, false).oneOf()
    all {
      phase == "undo1",
      keepScenario,
      undoFailed' = (undoFailed or (movedDefault and callFails)),
      phase' = "undo2",
      newExists' = newExists,
      active' = active,
      keyHolder' = keyHolder,
      keyMoved' = keyMoved,
      movedDefault' = movedDefault,
      rejectedByStripe' = rejectedByStripe,
      dashboardTouched' = dashboardTouched,
      if (movedDefault and not(callFails)) all {
        defaultPrice' = "OLD",
        transientFailure' = transientFailure,
      } else all {
        defaultPrice' = defaultPrice,
        transientFailure' = (transientFailure or (movedDefault and callFails)),
      },
    }
  }

  // U2. give the lookup key back to OLD
  action undoKey = {
    nondet callFails = Set(true, false).oneOf()
    all {
      phase == "undo2",
      keepScenario,
      undoFailed' = (undoFailed or (keyMoved and callFails)),
      phase' = "undo3",
      newExists' = newExists,
      active' = active,
      keyMoved' = keyMoved,
      defaultPrice' = defaultPrice,
      movedDefault' = movedDefault,
      rejectedByStripe' = rejectedByStripe,
      dashboardTouched' = dashboardTouched,
      if (keyMoved and not(callFails)) all {
        keyHolder' = "OLD",
        transientFailure' = transientFailure,
      } else all {
        keyHolder' = keyHolder,
        transientFailure' = (transientFailure or (keyMoved and callFails)),
      },
    }
  }

  // U3. archive NEW
  action undoNew = {
    nondet callFails = Set(true, false).oneOf()
    all {
      phase == "undo3",
      keepScenario,
      undoFailed' = (undoFailed or (active.contains("NEW") and defaultPrice != "NEW" and callFails)),
      phase' = "failed",
      newExists' = newExists,
      keyHolder' = keyHolder,
      keyMoved' = keyMoved,
      defaultPrice' = defaultPrice,
      movedDefault' = movedDefault,
      dashboardTouched' = dashboardTouched,
      if (not(active.contains("NEW"))) all {
        active' = active,
        transientFailure' = transientFailure,
        rejectedByStripe' = rejectedByStripe,
      } else if (defaultPrice == "NEW") all {
        // Stripe: a default price cannot be archived
        active' = active,
        transientFailure' = transientFailure,
        rejectedByStripe' = true,
      } else if (callFails) all {
        active' = active,
        transientFailure' = true,
        rejectedByStripe' = rejectedByStripe,
      } else all {
        active' = active.exclude(Set("NEW")),
        transientFailure' = transientFailure,
        rejectedByStripe' = rejectedByStripe,
      },
    }
  }

  // Someone sets the default price in the Dashboard while deploy runs
  action dashboardSetsDefault = {
    nondet p = Set("OLD", "NEW").oneOf()
    all {
      dashboardEnabled,
      running,
      active.contains(p),
      keepScenario,
      undoFailed' = undoFailed,
      phase' = phase,
      newExists' = newExists,
      active' = active,
      keyHolder' = keyHolder,
      keyMoved' = keyMoved,
      defaultPrice' = p,
      movedDefault' = movedDefault,
      transientFailure' = transientFailure,
      rejectedByStripe' = rejectedByStripe,
      dashboardTouched' = true,
    }
  }

  action finished = all {
    not(running),
    keepScenario,
    undoFailed' = undoFailed,
    phase' = phase,
    newExists' = newExists,
    active' = active,
    keyHolder' = keyHolder,
    keyMoved' = keyMoved,
    defaultPrice' = defaultPrice,
    movedDefault' = movedDefault,
    transientFailure' = transientFailure,
    rejectedByStripe' = rejectedByStripe,
    dashboardTouched' = dashboardTouched,
  }

  action step = any {
    createNew,
    moveDefault,
    archiveOld,
    undoDefault,
    undoKey,
    undoNew,
    dashboardSetsDefault,
    finished,
  }

  // ---------- Properties ----------

  // Sanity: the model never lets the default price be inactive (Stripe enforces it).
  val defaultIsActive: bool = defaultPrice == "" or active.contains(defaultPrice)

  // When deploy ends, at most one version of the slot is on sale.
  val atMostOneActiveAtEnd: bool =
    running or active.intersect(Set("OLD", "NEW")).size() <= 1

  // A failed deploy leaves things as they were: OLD on sale, with its key and default.
  val failureRestores: bool =
    phase != "failed" or all {
      active.contains("OLD"),
      not(active.contains("NEW")),
      hasKey implies keyHolder == "OLD",
      wasDefault implies defaultPrice == "OLD",
    }

  // A successful deploy leaves NEW as the only version, with the key and the default.
  val successResult: bool =
    phase != "done" or all {
      not(active.contains("OLD")),
      active.contains("NEW") == desiredActive,
      hasKey implies keyHolder == "NEW",
      (wasDefault and not(dashboardTouched)) implies defaultPrice == "NEW",
    }

  // Deploy fails only because of transient errors or a concurrent Dashboard change,
  // never because the To-be procedure asks Stripe for something it always rejects.
  val failsOnlyOnTransientOrRace: bool =
    phase != "failed" or transientFailure or dashboardTouched

  // ---------- Diagnosis: the causes of each counterexample ----------
  // R1: a best-effort undo call fails.
  // R2: the Dashboard changes the default price while deploy runs.
  // R3: the definition sets active: false while OLD is the default price,
  //     so the default price cannot move to NEW (Stripe rejects an inactive default).
  val r3: bool = not(desiredActive) and wasDefault

  // Holding once R1 and R2 are excluded shows that nothing else breaks these.
  val atMostOneActiveUnlessR1R2: bool = undoFailed or dashboardTouched or atMostOneActiveAtEnd
  val failureRestoresUnlessR1R2: bool = undoFailed or dashboardTouched or failureRestores
  // Holding once R3 is excluded shows that nothing else makes deploy fail by itself.
  val failsOnlyOnTransientOrRaceUnlessR3: bool = r3 or failsOnlyOnTransientOrRace

  // Witnesses: each cause alone breaks a property.
  val noR1Break: bool = not(undoFailed and not(dashboardTouched) and not(failureRestores))
  val noR2Break: bool = not(dashboardTouched and not(transientFailure) and not(atMostOneActiveAtEnd))
  val noR3Break: bool = not(r3 and not(dashboardEnabled) and phase == "failed" and not(transientFailure))
}
