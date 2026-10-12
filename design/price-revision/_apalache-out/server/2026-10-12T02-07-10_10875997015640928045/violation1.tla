---------------------------- MODULE counterexample ----------------------------

EXTENDS price_revision

(* Constant initialization state *)
ConstInit == TRUE

(* Initial state [_transition(0)] *)
State0 ==
  active = {"OLD"}
    /\ dashboardEnabled = FALSE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "OLD"
    /\ keyMoved = FALSE
    /\ movedDefault = FALSE
    /\ newExists = FALSE
    /\ phase = "start"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ wasDefault = TRUE

(* State1 [_transition(3)] *)
State1 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = FALSE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "created"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = FALSE
    /\ wasDefault = TRUE

(* State2 [_transition(6)] *)
State2 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = FALSE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo1"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = TRUE
    /\ wasDefault = TRUE

(* State3 [_transition(12)] *)
State3 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = FALSE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "NEW"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo2"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = TRUE
    /\ wasDefault = TRUE

(* State4 [_transition(13)] *)
State4 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = FALSE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "OLD"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "undo3"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = TRUE
    /\ wasDefault = TRUE

(* State5 [_transition(17)] *)
State5 ==
  active = { "NEW", "OLD" }
    /\ dashboardEnabled = FALSE
    /\ dashboardTouched = FALSE
    /\ defaultPrice = "OLD"
    /\ desiredActive = TRUE
    /\ hasKey = TRUE
    /\ keyHolder = "OLD"
    /\ keyMoved = TRUE
    /\ movedDefault = FALSE
    /\ newExists = TRUE
    /\ phase = "failed"
    /\ rejectedByStripe = FALSE
    /\ transientFailure = TRUE
    /\ wasDefault = TRUE

(* The following formula holds true in the last state and violates the invariant *)
InvariantViolation ==
  phase \in { "done", "failed" }
    /\ (LET t_8 == { t_5_1 \in active: t_5_1 \in { "OLD", "NEW" } } IN
    Skolem((\E t_6 \in t_8: Skolem((\E t_7 \in t_8: ~(t_6 = t_7))))))

================================================================================
(* Created by Apalache on Mon Oct 12 02:07:17 UTC 2026 *)
(* https://github.com/apalache-mc/apalache *)
