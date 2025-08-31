-- Migration: Add accountId and plaidTransactionId to transactions table
-- Date: 2025-08-31
-- Description: Add missing fields for better transaction tracking and debugging

-- Add accountId column to link transactions to Plaid account IDs
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS accountId TEXT;

-- Add plaidTransactionId column for direct Plaid API reference
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS plaidTransactionId TEXT;

-- Add index for efficient lookups by accountId
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(accountId);

-- Add index for efficient lookups by plaidTransactionId  
CREATE INDEX IF NOT EXISTS idx_transactions_plaid_transaction_id ON transactions(plaidTransactionId);

-- Update the constraint to ensure plaidTransactionId is unique when not null
-- (transactionId is already unique, this is for the Plaid-specific ID)
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_plaid_transaction_id_unique 
ON transactions(plaidTransactionId) 
WHERE plaidTransactionId IS NOT NULL;

-- Add comments to document the new columns
COMMENT ON COLUMN transactions.accountId IS 'Plaid account ID for linking transactions to accounts';
COMMENT ON COLUMN transactions.plaidTransactionId IS 'Original Plaid transaction ID for API reference';

-- Display results
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'transactions' 
AND column_name IN ('accountId', 'plaidTransactionId')
ORDER BY column_name;