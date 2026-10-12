-- AlterTable
ALTER TABLE "email_drafts" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "fromEmail" TEXT;
