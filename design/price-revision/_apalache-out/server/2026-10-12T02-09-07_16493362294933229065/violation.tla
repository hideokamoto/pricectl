---------------------------- MODULE counterexample ----------------------------

EXTENDS price_revision

(* Constant initialization state *)
ConstInit == TRUE

(* Initial state [_transition(0)] *)
State0 ==
  active = {"OLD"}
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = FALSE
    /\ hasKey = TRUE
    /\ keyHolder = "OLD"
    /\ keyMoved = FALSE
    /\ movedDefault = FALSE
    /\ newExists = FALSE
    /\ phase = "start"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = TRUE

(* State1 [_transition(3)] *)
State1 ==
  active = {"OLD"}
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = FALSE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "created"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = TRUE

(* State2 [_transition(5)] *)
State2 ==
  active = {"OLD"}
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = FALSE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo1"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = TRUE

(* State3 [_transition(12)] *)
State3 ==
  active = {"OLD"}
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = FALSE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo2"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = TRUE

(* State4 [_transition(14)] *)
State4 ==
  active = {"OLD"}
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = FALSE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo3"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = TRUE
    /\ undoFailed = TRUE
    /\ wasDefault = TRUE

(* State5 [_transition(15)] *)
State5 ==
  active = {"OLD"}
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = FALSE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "failed"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = TRUE
    /\ undoFailed = TRUE
    /\ wasDefault = TRUE

(* The following formula holds true in the last state and violates the invariant *)
InvariantViolation ==
  (undoFailed /\ ~dashboardTouched)
    /\ (phase = "failed"
      /\ (~("OLD" \in active)
        \/ "NEW" \in active
        \/ (hasKey /\ ~(keyHolder = "OLD"))
        \/ (wasDefault /\ ~(defaultPrice = "OLD"))))

================================================================================
(* Created by Apalache on Mon Oct 12 02:09:13 UTC 2026 *)
(* https://github.com/apalache-mc/apalache *)
