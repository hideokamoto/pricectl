---------------------------- MODULE counterexample ----------------------------

EXTENDS price_revision_v2

(* Constant initialization state *)
ConstInit == TRUE

(* Initial state [_transition(0)] *)
State0 ==
  s
      = [active |-> {"OLD"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> {"OLD"},
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "idle",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 0,
        target |-> ""]

(* State1 [_transition(5)] *)
State1 ==
  s
      = [active |-> {"OLD"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> {"OLD"},
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "create",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> ""]

(* State2 [_transition(6)] *)
State2 ==
  s
      = [active |-> { "N1", "OLD" },
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "activate",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* State3 [_transition(1)] *)
State3 ==
  s
      = [active |-> { "N1", "OLD" },
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "key",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* State4 [_transition(2)] *)
State4 ==
  s
      = [active |-> { "N1", "OLD" },
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "default",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* State5 [_transition(10)] *)
State5 ==
  s
      = [active |-> { "N1", "OLD" },
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "archive",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* State6 [_transition(18)] *)
State6 ==
  s
      = [active |-> {"N1"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "archive",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* State7 [_transition(13)] *)
State7 ==
  s
      = [active |-> {"N1"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "deactivate",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* State8 [_transition(15)] *)
State8 ==
  s
      = [active |-> {"N1"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "commit",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* State9 [_transition(3)] *)
State9 ==
  s
      = [active |-> {"N1"},
        current |-> "N1",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> FALSE,
        exists |-> { "N1", "OLD" },
        hasKey |-> FALSE,
        keyHolder |-> "",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> TRUE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "idle",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> "N1"]

(* The following formula holds true in the last state and violates the invariant *)
InvariantViolation == s["lastOk"]

================================================================================
(* Created by Apalache on Mon Oct 12 05:07:40 UTC 2026 *)
(* https://github.com/apalache-mc/apalache *)
