-- CreateEnum
CREATE TYPE "academic_program" AS ENUM ('BCA', 'BCOM', 'BBA', 'MCA', 'MBA');

-- CreateEnum
CREATE TYPE "shift_status" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'ACTIVE', 'CHECKED_OUT', 'CLOSED', 'MISSED');

-- AlterTable
ALTER TABLE "parking_user_profiles" ADD COLUMN     "admission_year" SMALLINT,
ADD COLUMN     "current_semester" SMALLINT,
ADD COLUMN     "department" VARCHAR(80),
ADD COLUMN     "program" "academic_program";

-- AlterTable
ALTER TABLE "parking_sessions" ADD COLUMN     "exit_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "owner_user_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "processed_by_id" UUID,
ADD COLUMN     "shift_id" UUID;

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(60) NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "template_id" UUID,
    "shift_name" VARCHAR(60) NOT NULL,
    "shift_date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "gate" VARCHAR(60),
    "status" "shift_status" NOT NULL DEFAULT 'SCHEDULED',
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_out_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "note" VARCHAR(255),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "security_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_handovers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shift_id" UUID NOT NULL,
    "expected_cash_paise" INTEGER NOT NULL,
    "actual_cash_paise" INTEGER NOT NULL,
    "difference_paise" INTEGER NOT NULL,
    "cash_transactions" INTEGER NOT NULL,
    "digital_paise" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "received_by_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "resolution_note" VARCHAR(500),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_templates_name_key" ON "shift_templates"("name");

-- CreateIndex
CREATE INDEX "security_shifts_staff_id_starts_at_idx" ON "security_shifts"("staff_id", "starts_at");

-- CreateIndex
CREATE INDEX "security_shifts_shift_date_status_idx" ON "security_shifts"("shift_date", "status");

-- CreateIndex
CREATE INDEX "security_shifts_status_ends_at_idx" ON "security_shifts"("status", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_handovers_shift_id_key" ON "cash_handovers"("shift_id");

-- CreateIndex
CREATE INDEX "cash_handovers_difference_paise_resolved_at_idx" ON "cash_handovers"("difference_paise", "resolved_at");

-- CreateIndex
CREATE INDEX "parking_user_profiles_program_admission_year_current_semest_idx" ON "parking_user_profiles"("program", "admission_year", "current_semester");

-- CreateIndex
CREATE INDEX "parking_sessions_owner_user_id_entry_at_idx" ON "parking_sessions"("owner_user_id", "entry_at");

-- CreateIndex
CREATE INDEX "payments_shift_id_status_method_idx" ON "payments"("shift_id", "status", "method");

-- CreateIndex
CREATE INDEX "payments_processed_by_id_paid_at_idx" ON "payments"("processed_by_id", "paid_at");

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_processed_by_id_fkey" FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "security_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_shifts" ADD CONSTRAINT "security_shifts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_shifts" ADD CONSTRAINT "security_shifts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_shifts" ADD CONSTRAINT "security_shifts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "security_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfills. Existing rows stay valid and keep their meaning.
-- ---------------------------------------------------------------------------

-- A session records the account that owned the vehicle when it began. This is the
-- rule the portal always applied (sessions that began after the owner registered the
-- vehicle), now stored on the session so the owner keeps their history if they later
-- release the vehicle.
UPDATE "parking_sessions" AS s
SET "owner_user_id" = v."owner_user_id"
FROM "vehicles" AS v
WHERE v."id" = s."vehicle_id"
  AND v."owner_user_id" IS NOT NULL
  AND v."owner_since" IS NOT NULL
  AND s."entry_at" >= v."owner_since";

-- A paid payment was taken by whoever finalized its session (visitor checkouts have no account).
UPDATE "payments" AS p
SET "processed_by_id" = s."checked_out_by_id"
FROM "parking_sessions" AS s
WHERE s."id" = p."session_id"
  AND p."status" = 'PAID'
  AND s."checked_out_by_id" IS NOT NULL;


-- ---------------------------------------------------------------------------
-- Integrity constraints (not expressible in the Prisma schema language).
-- ---------------------------------------------------------------------------

-- Academic identity: all four columns or none (accounts that registered before these
-- details were collected have none), only for students, within the program's semesters.
ALTER TABLE "parking_user_profiles" ADD CONSTRAINT "parking_user_profiles_academic_profile_valid" CHECK (
  (
    "program" IS NULL AND "department" IS NULL
    AND "admission_year" IS NULL AND "current_semester" IS NULL
  )
  OR (
    "category" = 'STUDENT'
    AND "program" IS NOT NULL AND "department" IS NOT NULL
    AND "admission_year" IS NOT NULL AND "current_semester" IS NOT NULL
    AND length(btrim("department")) >= 2
    AND "admission_year" BETWEEN 2000 AND 2100
    AND "current_semester" >= 1
    AND "current_semester" <= CASE WHEN "program" IN ('MCA', 'MBA') THEN 4 ELSE 6 END
  )
);

-- A shift template is a time of day pair; an end at or before the start crosses midnight.
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_minutes_valid" CHECK (
  "start_minute" BETWEEN 0 AND 1439
  AND "end_minute" BETWEEN 0 AND 1439
  AND "start_minute" <> "end_minute"
);

-- A shift has a positive window, and its status agrees with its timestamps.
ALTER TABLE "security_shifts" ADD CONSTRAINT "security_shifts_window_valid" CHECK ("ends_at" > "starts_at");
ALTER TABLE "security_shifts" ADD CONSTRAINT "security_shifts_status_has_times" CHECK (
  ("status" NOT IN ('CHECKED_IN', 'ACTIVE', 'CHECKED_OUT', 'CLOSED') OR "checked_in_at" IS NOT NULL)
  AND ("status" NOT IN ('CHECKED_OUT', 'CLOSED') OR "checked_out_at" IS NOT NULL)
  AND (("status" = 'CLOSED') = ("closed_at" IS NOT NULL))
);

-- A cash handover is exact arithmetic; a mismatch carries its reason, and a review is complete.
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_amounts_valid" CHECK (
  "expected_cash_paise" >= 0 AND "actual_cash_paise" >= 0
  AND "cash_transactions" >= 0 AND "digital_paise" >= 0
  AND "difference_paise" = "actual_cash_paise" - "expected_cash_paise"
);
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_mismatch_has_note"
  CHECK ("difference_paise" = 0 OR "note" IS NOT NULL);
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_resolution_complete" CHECK (
  ("resolved_at" IS NULL) = ("resolved_by_id" IS NULL)
  AND ("resolved_at" IS NULL OR "resolution_note" IS NOT NULL)
);
