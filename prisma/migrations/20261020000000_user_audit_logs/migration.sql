CREATE TYPE "UserAuditAction" AS ENUM ('UPDATE', 'DELETE');

CREATE TABLE "UserAuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" "UserAuditAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserAuditLog_action_createdAt_idx" ON "UserAuditLog"("action", "createdAt");
CREATE INDEX "UserAuditLog_userId_action_createdAt_idx" ON "UserAuditLog"("userId", "action", "createdAt");