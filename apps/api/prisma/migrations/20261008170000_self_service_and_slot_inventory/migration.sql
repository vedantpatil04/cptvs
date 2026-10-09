-- CreateEnum
CREATE TYPE "park_now_offer_status" AS ENUM ('OFFERED', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "checkout_channel" AS ENUM ('SECURITY', 'SELF_SERVICE', 'VISITOR');

-- AlterTable
ALTER TABLE "parking_sessions" ADD COLUMN     "checked_out_via" "checkout_channel";

-- AlterTable
ALTER TABLE "parking_slots" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "is_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "park_now_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "hold_token" VARCHAR(64) NOT NULL,
    "status" "park_now_offer_status" NOT NULL DEFAULT 'OFFERED',
    "allocation" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "park_now_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "params" JSONB,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "park_now_offers_status_expires_at_idx" ON "park_now_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "park_now_offers_slot_id_idx" ON "park_now_offers"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "park_now_offers_one_open_per_user" ON "park_now_offers"("user_id") WHERE ("status" = 'OFFERED');

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "park_now_offers" ADD CONSTRAINT "park_now_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "park_now_offers" ADD CONSTRAINT "park_now_offers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "park_now_offers" ADD CONSTRAINT "park_now_offers_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "parking_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity constraints (not expressible in the Prisma schema language).
-- ---------------------------------------------------------------------------

-- An archived (soft-deleted) slot is idle: it can never hold a vehicle or a Park Now hold.
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_archived_is_idle"
  CHECK ("archived_at" IS NULL OR "status" IN ('AVAILABLE', 'BLOCKED'));

-- A completed session records who checked it out: a staff or owner account, or
-- (for visitors, who have no account) the VISITOR channel.
ALTER TABLE "parking_sessions" DROP CONSTRAINT "parking_sessions_completed_has_checkout";
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_completed_has_checkout" CHECK (
  "status" <> 'COMPLETED'
  OR ("exit_hour" IS NOT NULL AND "exit_at" IS NOT NULL AND "duration_hours" IS NOT NULL
      AND "fee_amount_paise" IS NOT NULL
      AND ("checked_out_by_id" IS NOT NULL OR "checked_out_via" = 'VISITOR'))
);
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_visitor_checkout_has_no_account"
  CHECK ("checked_out_via" IS DISTINCT FROM 'VISITOR' OR "checked_out_by_id" IS NULL);
