-- AlterTable
ALTER TABLE "parking_sessions" ADD COLUMN "exit_captured_at" TIMESTAMPTZ(3),
ADD COLUMN "time_adjusted_at" TIMESTAMPTZ(3);
