---------------------------- MODULE counterexample ----------------------------

EXTENDS price_revision

(* Constant initialization state *)
ConstInit == TRUE

(* Initial state [_transition(0)] *)
State0 ==
  active = {"OLD"}
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = ""
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "OLD"
    /\ keyMoved = FALSE
    /\ movedDefault = FALSE
    /\ newExists = FALSE
    /\ phase = "start"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State1 [_transition(3)] *)
State1 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = ""
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "created"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State2 [_transition(4)] *)
State2 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = ""
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "defaultDone"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State3 [_transition(1)] *)
State3 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = TRUE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "defaultDone"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State4 [_transition(8)] *)
State4 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = TRUE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo1"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State5 [_transition(12)] *)
State5 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = TRUE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo2"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State6 [_transition(1)] *)
State6 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = TRUE
    /\ defaultPrice = "NEW"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo2"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State7 [_transition(13)] *)
State7 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = TRUE
    /\ defaultPrice = "NEW"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "OLD"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo3"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* State8 [_transition(16)] *)
State8 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = TRUE
    /\ dashboardTouched = TRUE
    /\ defaultPrice = "NEW"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "OLD"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "failed"
    /\ rejectedByStripe = TRUE
    /\ transientFailure = FALSE
    /\ undoFailed = FALSE
    /\ wasDefault = FALSE

(* The following formula holds true in the last state and violates the invariant *)
InvariantViolation ==
  (dashboardTouched /\ ~transientFailure)
    /\ (phase \in { "done", "failed" }
      /\ (LET t_8 == { t_5_1 \in active: t_5_1 \in { "OLD", "NEW" } } IN
      Skolem((\E t_6 \in t_8: Skolem((\E t_7 \in t_8: ~(t_6 = t_7)))))))

================================================================================
(* Created by Apalache on Mon Oct 12 02:09:23 UTC 2026 *)
(* https://github.com/apalache-mc/apalache *)
