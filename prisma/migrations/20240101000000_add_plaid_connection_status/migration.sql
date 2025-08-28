-- Add connection status tracking to PlaidItem
ALTER TABLE "plaid_items" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "plaid_items" ADD COLUMN "lastSyncAt" TIMESTAMP(3);
ALTER TABLE "plaid_items" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "plaid_items" ADD COLUMN "errorMessage" TEXT;

-- Add comment for status values
COMMENT ON COLUMN "plaid_items"."status" IS 'Connection status: active, error, expired, disconnected';