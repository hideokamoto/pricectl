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
        defaultPrice |-> "",
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
        defaultAtStart |-> "",
        defaultPrice |-> "",
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

(* State2 [_transition(8)] *)
State2 ==
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
        phase |-> "create",
        reusedStray |-> FALSE,
        runDashboard |-> TRUE,
        runRejected |-> FALSE,
        runTransient |-> FALSE,
        runs |-> 1,
        target |-> ""]

(* State3 [_transition(0)] *)
State3 ==
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
        phase |-> "undo",
        reusedStray |-> FALSE,
        runDashboard |-> TRUE,
        runRejected |-> FALSE,
        runTransient |-> TRUE,
        runs |-> 1,
        target |-> ""]

(* State4 [_transition(7)] *)
State4 ==
  s
      = [active |-> {"OLD"},
        current |-> "OLD",
        dashboardEnabled |-> TRUE,
        defaultAtStart |-> "",
        defaultPrice |-> "OLD",
        desiredActive |-> TRUE,
        everFailed |-> TRUE,
        exists |-> {"OLD"},
        hasKey |-> TRUE,
        keyHolder |-> "OLD",
        lastDashboard |-> TRUE,
        lastDefaultAtStart |-> "",
        lastOk |-> FALSE,
        lastRejected |-> FALSE,
        lastTransient |-> TRUE,
        phase |-> "idle",
        reusedStray |-> FALSE,
        runDashboard |-> TRUE,
        runRejected |-> FALSE,
        runTransient |-> TRUE,
        runs |-> 1,
        target |-> ""]

(* The following formula holds true in the last state and violates the invariant *)
InvariantViolation == s["lastDashboard"] /\ ~(s["lastOk"])

================================================================================
(* Created by Apalache on Mon Oct 12 05:08:17 UTC 2026 *)
(* https://github.com/apalache-mc/apalache *)
