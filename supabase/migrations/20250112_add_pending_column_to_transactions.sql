-- Migration: Add pending column to transactions table
-- Date: 2025-01-12
-- Description: Add pending field to track transaction status from Plaid API

-- Add pending column to transactions table
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS pending BOOLEAN DEFAULT false;

-- Add index for efficient lookups by pending status
CREATE INDEX IF NOT EXISTS idx_transactions_pending ON transactions(pending);

-- Add comment to document the new column
COMMENT ON COLUMN transactions.pending IS 'Whether the transaction is pending (from Plaid API)';

-- Display results
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'transactions' 
AND column_name = 'pending'
ORDER BY column_name;