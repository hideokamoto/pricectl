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
        hasKey |-> TRUE,
        keyHolder |-> "OLD",
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
        hasKey |-> TRUE,
        keyHolder |-> "OLD",
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
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "undo",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> TRUE,
        runs |-> 1,
        target |-> "N1"]

(* State3 [_transition(7)] *)
State3 ==
  s
      = [active |-> {"OLD"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "idle",
        reusedStray |-> FALSE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> TRUE,
        runs |-> 1,
        target |-> "N1"]

(* State4 [_transition(5)] *)
State4 ==
  s
      = [active |-> {"OLD"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "activate",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* State5 [_transition(1)] *)
State5 ==
  s
      = [active |-> { "N1", "OLD" },
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "key",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* State6 [_transition(2)] *)
State6 ==
  s
      = [active |-> { "N1", "OLD" },
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "default",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* State7 [_transition(10)] *)
State7 ==
  s
      = [active |-> { "N1", "OLD" },
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "archive",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* State8 [_transition(18)] *)
State8 ==
  s
      = [active |-> {"N1"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "archive",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* State9 [_transition(13)] *)
State9 ==
  s
      = [active |-> {"N1"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "deactivate",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* State10 [_transition(15)] *)
State10 ==
  s
      = [active |-> {"N1"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "commit",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* State11 [_transition(3)] *)
State11 ==
  s
      = [active |-> {"N1"},
        current |-> "N1",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "OLD",
        defaultPrice |-> "N1",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> { "N1", "OLD" },
        hasKey |-> TRUE,
        keyHolder |-> "N1",
        lastDashboard |-> FALSE,
        lastDefaultAtStart |-> "OLD",
        lastOk |-> TRUE,
        lastRejected |-> FALSE,
        lastTransient |-> FALSE,
        phase |-> "idle",
        reusedStray |-> TRUE,
        runDashboard |-> FALSE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 2,
        target |-> "N1"]

(* The following formula holds true in the last state and violates the invariant *)
InvariantViolation == s["everFailed"] /\ s["lastOk"]

================================================================================
(* Created by Apalache on Mon Oct 12 05:07:53 UTC 2026 *)
(* https://github.com/apalache-mc/apalache *)
