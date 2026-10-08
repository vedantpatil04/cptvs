-- CreateEnum
CREATE TYPE "parking_user_category" AS ENUM ('STUDENT', 'STAFF');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum
ALTER TYPE "user_role" ADD VALUE 'PARKING_USER';

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" VARCHAR(40),
ADD COLUMN     "owner_since" TIMESTAMPTZ(3),
ADD COLUMN     "owner_user_id" UUID;

-- CreateTable
CREATE TABLE "parking_user_profiles" (
    "user_id" UUID NOT NULL,
    "category" "parking_user_category" NOT NULL,
    "institutional_id" VARCHAR(32) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "verification_status" "verification_status" NOT NULL DEFAULT 'PENDING',
    "verification_note" VARCHAR(500),
    "verification_submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "preferred_locale" VARCHAR(8),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parking_user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "identity_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "institutional_id" VARCHAR(32) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parking_user_profiles_email_key" ON "parking_user_profiles"("email");

-- CreateIndex
CREATE INDEX "parking_user_profiles_category_verification_status_idx" ON "parking_user_profiles"("category", "verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "parking_user_profiles_category_institutional_id_key" ON "parking_user_profiles"("category", "institutional_id");

-- CreateIndex
CREATE INDEX "identity_documents_user_id_created_at_idx" ON "identity_documents"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "vehicles_owner_user_id_idx" ON "vehicles"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_one_primary_per_owner" ON "vehicles"("owner_user_id") WHERE ("is_primary" = true);

-- AddForeignKey
ALTER TABLE "parking_user_profiles" ADD CONSTRAINT "parking_user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_user_profiles" ADD CONSTRAINT "parking_user_profiles_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Integrity rules enforced by the database (not expressible in the Prisma schema).
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_since_with_owner"
  CHECK (("owner_user_id" IS NULL) = ("owner_since" IS NULL));
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_primary_requires_owner"
  CHECK (NOT "is_primary" OR "owner_user_id" IS NOT NULL);
ALTER TABLE "parking_user_profiles" ADD CONSTRAINT "parking_user_profiles_email_lowercase"
  CHECK ("email" = lower("email"));
ALTER TABLE "parking_user_profiles" ADD CONSTRAINT "parking_user_profiles_institutional_id_uppercase"
  CHECK ("institutional_id" = upper("institutional_id"));
ALTER TABLE "parking_user_profiles" ADD CONSTRAINT "parking_user_profiles_rejection_has_note"
  CHECK ("verification_status" <> 'REJECTED' OR "verification_note" IS NOT NULL);
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_size"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 2097152 AND octet_length("content") = "size_bytes");
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_mime_type"
  CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'application/pdf'));
