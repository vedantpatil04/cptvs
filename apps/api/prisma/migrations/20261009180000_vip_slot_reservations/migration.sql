-- A slot an authorized Security Staff member keeps for an official/VIP guest or an emergency.
ALTER TYPE "slot_status" ADD VALUE IF NOT EXISTS 'RESERVED';

-- CreateEnum
CREATE TYPE "slot_reservation_status" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateTable
CREATE TABLE "slot_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slot_id" UUID NOT NULL,
    "vehicle_number" VARCHAR(20),
    "guest_name" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "status" "slot_reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "reserved_by_id" UUID NOT NULL,
    "reserved_by_name" VARCHAR(120) NOT NULL,
    "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" UUID,
    "released_by_name" VARCHAR(120),
    "released_at" TIMESTAMPTZ(3),
    "release_note" VARCHAR(300),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slot_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slot_reservations_status_reserved_at_idx" ON "slot_reservations"("status", "reserved_at");

-- CreateIndex
CREATE INDEX "slot_reservations_slot_id_idx" ON "slot_reservations"("slot_id");

-- CreateIndex: a slot has at most one active reservation
CREATE UNIQUE INDEX "slot_reservations_one_active_per_slot" ON "slot_reservations"("slot_id") WHERE ("status" = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "slot_reservations" ADD CONSTRAINT "slot_reservations_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "parking_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
