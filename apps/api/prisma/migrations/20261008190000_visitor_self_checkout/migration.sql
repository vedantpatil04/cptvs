-- Visitors and students check themselves out. A visitor has no account, so a completed
-- session no longer needs an operator on record ("checked_out_by_id" stays NULL for a visitor's
-- own checkout and the audit trail shows a system action). Everything else about a finished
-- session (exit time and hour, duration, fee) is still mandatory.
ALTER TABLE "parking_sessions" DROP CONSTRAINT "parking_sessions_completed_has_checkout";

ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_completed_has_checkout" CHECK (
    "status" <> 'COMPLETED'
    OR ("exit_hour" IS NOT NULL AND "exit_at" IS NOT NULL AND "duration_hours" IS NOT NULL
        AND "fee_amount_paise" IS NOT NULL)
  );
