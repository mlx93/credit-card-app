-- Migration: Verify manual credit limit columns exist in credit_cards table
-- Date: 2025-08-31
-- Description: The columns ismanuallimit and manualcreditlimit should already exist

-- Verify the columns exist and have correct structure
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_cards' 
        AND column_name = 'ismanuallimit'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_cards' 
        AND column_name = 'manualcreditlimit'
    ) THEN
        RAISE NOTICE 'Manual credit limit columns exist in credit_cards table';
        RAISE NOTICE 'ismanuallimit column: %', (SELECT data_type FROM information_schema.columns WHERE table_name = 'credit_cards' AND column_name = 'ismanuallimit');
        RAISE NOTICE 'manualcreditlimit column: %', (SELECT data_type FROM information_schema.columns WHERE table_name = 'credit_cards' AND column_name = 'manualcreditlimit');
    ELSE
        RAISE EXCEPTION 'Manual credit limit columns not found - they may need to be created manually';
    END IF;
END $$;

-- Create an index for efficient queries on manual limits if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_credit_cards_manual_limit ON credit_cards(ismanuallimit) WHERE ismanuallimit = TRUE;