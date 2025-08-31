-- Add missing columns to billing_cycles table
-- These columns are being inserted by the code but don't exist in the database

ALTER TABLE billing_cycles 
ADD COLUMN IF NOT EXISTS creditCardName TEXT,
ADD COLUMN IF NOT EXISTS transactionCount INTEGER DEFAULT 0;

-- Verify the table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'billing_cycles'
ORDER BY ordinal_position;