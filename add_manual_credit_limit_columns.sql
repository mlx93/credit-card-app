-- Migration: Add manual credit limit columns to credit_cards table
-- Date: 2025-08-31
-- Description: Adds isManualLimit and manualCreditLimit columns to support manual credit limit overrides

-- Add the manual credit limit columns
ALTER TABLE credit_cards 
ADD COLUMN IF NOT EXISTS isManualLimit BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS manualCreditLimit DECIMAL(12,2) DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN credit_cards.isManualLimit IS 'Whether this card uses a manually set credit limit instead of Plaid data';
COMMENT ON COLUMN credit_cards.manualCreditLimit IS 'Manually set credit limit when isManualLimit is true';

-- Create an index for efficient queries on manual limits
CREATE INDEX IF NOT EXISTS idx_credit_cards_manual_limit ON credit_cards(isManualLimit) WHERE isManualLimit = TRUE;

-- Verify the migration
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_cards' 
        AND column_name = 'isManualLimit'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_cards' 
        AND column_name = 'manualCreditLimit'
    ) THEN
        RAISE NOTICE 'Manual credit limit columns added successfully to credit_cards table';
    ELSE
        RAISE EXCEPTION 'Failed to add manual credit limit columns';
    END IF;
END $$;