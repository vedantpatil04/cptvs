-- CreateEnum
CREATE TYPE "visitor_reservation_status" AS ENUM ('HELD', 'ACTIVATED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "visitor_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(128) NOT NULL,
    "vehicle_number" VARCHAR(20) NOT NULL,
    "vehicle_type" "vehicle_type" NOT NULL,
    "contact_phone" VARCHAR(16) NOT NULL,
    "slot_id" UUID NOT NULL,
    "hold_token" VARCHAR(64) NOT NULL,
    "allocation" JSONB NOT NULL,
    "status" "visitor_reservation_status" NOT NULL DEFAULT 'HELD',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "session_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visitor_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitor_reservations_reference_key" ON "visitor_reservations"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "visitor_reservations_session_id_key" ON "visitor_reservations"("session_id");

-- CreateIndex
CREATE INDEX "visitor_reservations_status_expires_at_idx" ON "visitor_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "visitor_reservations_slot_id_idx" ON "visitor_reservations"("slot_id");

-- CreateIndex: one open (held) reservation per vehicle
CREATE UNIQUE INDEX "visitor_reservations_one_held_per_vehicle" ON "visitor_reservations"("vehicle_number") WHERE ("status" = 'HELD');

-- AddForeignKey
ALTER TABLE "visitor_reservations" ADD CONSTRAINT "visitor_reservations_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "parking_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_reservations" ADD CONSTRAINT "visitor_reservations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "parking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
