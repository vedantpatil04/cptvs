-- CreateTable
CREATE TABLE "exit_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exit_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exit_codes_code_hash_expires_at_idx" ON "exit_codes"("code_hash", "expires_at");

-- CreateIndex
CREATE INDEX "exit_codes_session_id_idx" ON "exit_codes"("session_id");

-- AddForeignKey
ALTER TABLE "exit_codes" ADD CONSTRAINT "exit_codes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "parking_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
