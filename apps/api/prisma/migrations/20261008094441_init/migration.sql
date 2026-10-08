-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'SECURITY_STAFF');

-- CreateEnum
CREATE TYPE "vehicle_type" AS ENUM ('TWO_WHEELER', 'FOUR_WHEELER');

-- CreateEnum
CREATE TYPE "owner_category" AS ENUM ('STAFF', 'STUDENT', 'VISITOR');

-- CreateEnum
CREATE TYPE "slot_status" AS ENUM ('AVAILABLE', 'HELD', 'OCCUPIED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "parking_session_status" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('UPI', 'CARD', 'CASH');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(64) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "user_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(255),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "parking_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parking_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "block_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "vehicle_type" "vehicle_type" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parking_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "zone_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "status" "slot_status" NOT NULL DEFAULT 'AVAILABLE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "blocked_reason" VARCHAR(255),
    "hold_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parking_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_number" VARCHAR(20) NOT NULL,
    "vehicle_type" "vehicle_type" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_number" VARCHAR(32) NOT NULL,
    "entry_reference" VARCHAR(128) NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "vehicle_type" "vehicle_type" NOT NULL,
    "owner_category" "owner_category" NOT NULL,
    "status" "parking_session_status" NOT NULL DEFAULT 'ACTIVE',
    "entry_hour" SMALLINT NOT NULL,
    "exit_hour" SMALLINT,
    "entry_at" TIMESTAMPTZ(3) NOT NULL,
    "exit_at" TIMESTAMPTZ(3),
    "duration_hours" INTEGER,
    "fee_amount_paise" INTEGER,
    "checked_in_by_id" UUID NOT NULL,
    "checked_out_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "transaction_id" VARCHAR(32) NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "amount_paise" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_number" VARCHAR(32) NOT NULL,
    "verification_reference" VARCHAR(128) NOT NULL,
    "session_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "parking_blocks_code_key" ON "parking_blocks"("code");

-- CreateIndex
CREATE UNIQUE INDEX "parking_zones_code_key" ON "parking_zones"("code");

-- CreateIndex
CREATE INDEX "parking_zones_block_id_idx" ON "parking_zones"("block_id");

-- CreateIndex
CREATE INDEX "parking_zones_vehicle_type_is_active_idx" ON "parking_zones"("vehicle_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "parking_slots_code_key" ON "parking_slots"("code");

-- CreateIndex
CREATE INDEX "parking_slots_zone_id_status_idx" ON "parking_slots"("zone_id", "status");

-- CreateIndex
CREATE INDEX "parking_slots_status_idx" ON "parking_slots"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vehicle_number_key" ON "vehicles"("vehicle_number");

-- CreateIndex
CREATE INDEX "vehicles_vehicle_type_idx" ON "vehicles"("vehicle_type");

-- CreateIndex
CREATE UNIQUE INDEX "parking_sessions_session_number_key" ON "parking_sessions"("session_number");

-- CreateIndex
CREATE UNIQUE INDEX "parking_sessions_entry_reference_key" ON "parking_sessions"("entry_reference");

-- CreateIndex
CREATE INDEX "parking_sessions_vehicle_id_created_at_idx" ON "parking_sessions"("vehicle_id", "created_at");

-- CreateIndex
CREATE INDEX "parking_sessions_slot_id_created_at_idx" ON "parking_sessions"("slot_id", "created_at");

-- CreateIndex
CREATE INDEX "parking_sessions_status_entry_at_idx" ON "parking_sessions"("status", "entry_at");

-- CreateIndex
CREATE INDEX "parking_sessions_exit_at_idx" ON "parking_sessions"("exit_at");

-- CreateIndex
CREATE UNIQUE INDEX "parking_sessions_one_active_per_vehicle" ON "parking_sessions"("vehicle_id") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "parking_sessions_one_active_per_slot" ON "parking_sessions"("slot_id") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "payments_transaction_id_key" ON "payments"("transaction_id");

-- CreateIndex
CREATE INDEX "payments_session_id_created_at_idx" ON "payments"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_one_paid_per_session" ON "payments"("session_id") WHERE ("status" = 'PAID');

-- CreateIndex
CREATE UNIQUE INDEX "receipts_receipt_number_key" ON "receipts"("receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_verification_reference_key" ON "receipts"("verification_reference");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_session_id_key" ON "receipts"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE INDEX "receipts_issued_at_idx" ON "receipts"("issued_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_zones" ADD CONSTRAINT "parking_zones_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "parking_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "parking_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "parking_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_checked_in_by_id_fkey" FOREIGN KEY ("checked_in_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_checked_out_by_id_fkey" FOREIGN KEY ("checked_out_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "parking_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "parking_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity constraints not expressible in the Prisma schema language.
-- Prisma does not introspect CHECK constraints, so they do not cause drift.
-- ---------------------------------------------------------------------------

ALTER TABLE "parking_blocks"
  ADD CONSTRAINT "parking_blocks_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "parking_blocks_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "parking_blocks_coordinates_paired" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

ALTER TABLE "parking_slots"
  ADD CONSTRAINT "parking_slots_hold_matches_status" CHECK (("status" = 'HELD') = ("hold_expires_at" IS NOT NULL));

ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_entry_hour_range" CHECK ("entry_hour" BETWEEN 0 AND 23),
  ADD CONSTRAINT "parking_sessions_exit_hour_range" CHECK ("exit_hour" IS NULL OR "exit_hour" BETWEEN 0 AND 23),
  ADD CONSTRAINT "parking_sessions_exit_not_before_entry" CHECK ("exit_hour" IS NULL OR "exit_hour" >= "entry_hour"),
  ADD CONSTRAINT "parking_sessions_exit_at_not_before_entry_at" CHECK ("exit_at" IS NULL OR "exit_at" >= "entry_at"),
  ADD CONSTRAINT "parking_sessions_duration_non_negative" CHECK ("duration_hours" IS NULL OR "duration_hours" >= 0),
  ADD CONSTRAINT "parking_sessions_fee_non_negative" CHECK ("fee_amount_paise" IS NULL OR "fee_amount_paise" >= 0),
  ADD CONSTRAINT "parking_sessions_completed_has_checkout" CHECK (
    "status" <> 'COMPLETED'
    OR ("exit_hour" IS NOT NULL AND "exit_at" IS NOT NULL AND "duration_hours" IS NOT NULL
        AND "fee_amount_paise" IS NOT NULL AND "checked_out_by_id" IS NOT NULL)
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount_paise" >= 0),
  ADD CONSTRAINT "payments_paid_has_timestamp" CHECK (("status" = 'PAID') = ("paid_at" IS NOT NULL));

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_amount_non_negative" CHECK ("amount_paise" >= 0);
