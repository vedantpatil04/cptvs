-- AlterTable
ALTER TABLE "parking_sessions" ADD COLUMN     "fee_breakdown" JSONB;

-- AlterTable
ALTER TABLE "parking_slots" ADD COLUMN     "hold_token" VARCHAR(64);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "exit_hour" SMALLINT NOT NULL,
ADD COLUMN     "failure_reason" VARCHAR(64),
ADD COLUMN     "is_simulated" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "payments_one_open_per_session" ON "payments"("session_id") WHERE (status = ANY (ARRAY['PENDING'::payment_status, 'PROCESSING'::payment_status]));


-- ---------------------------------------------------------------------------
-- Integrity constraints (not expressible in the Prisma schema language).
-- ---------------------------------------------------------------------------

-- A HELD slot always carries both a hold expiry and the token of its holder.
ALTER TABLE "parking_slots" DROP CONSTRAINT "parking_slots_hold_matches_status";
ALTER TABLE "parking_slots"
  ADD CONSTRAINT "parking_slots_hold_matches_status" CHECK (
    ("status" = 'HELD') = ("hold_expires_at" IS NOT NULL)
    AND ("status" = 'HELD') = ("hold_token" IS NOT NULL)
  );

-- A completed session carries its frozen fee breakdown.
ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_completed_has_fee_breakdown" CHECK (
    "status" <> 'COMPLETED' OR "fee_breakdown" IS NOT NULL
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_exit_hour_range" CHECK ("exit_hour" BETWEEN 0 AND 23),
  -- ₹0 checkouts use NO_CHARGE, and NO_CHARGE is only valid for ₹0.
  ADD CONSTRAINT "payments_no_charge_iff_zero" CHECK (("method" = 'NO_CHARGE') = ("amount_paise" = 0)),
  ADD CONSTRAINT "payments_failure_reason_only_when_failed" CHECK (
    "failure_reason" IS NULL OR "status" IN ('FAILED', 'CANCELLED')
  );
