-- Add manual cycle date configuration fields to credit_cards table
-- These are used when Plaid can't provide statement dates (e.g., Robinhood)

ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS manual_cycle_day INTEGER CHECK (manual_cycle_day >= 1 AND manual_cycle_day <= 31);
ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS manual_due_day INTEGER CHECK (manual_due_day >= 1 AND manual_due_day <= 31);
ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS manual_dates_configured BOOLEAN DEFAULT FALSE;

-- Add comments for clarity
COMMENT ON COLUMN credit_cards.manual_cycle_day IS 'Day of month when statement closes (1-31), manually set by user';
COMMENT ON COLUMN credit_cards.manual_due_day IS 'Day of month when payment is due (1-31), manually set by user';
COMMENT ON COLUMN credit_cards.manual_dates_configured IS 'Whether user has manually configured cycle dates';

-- Create an index for faster lookups of cards needing manual configuration
CREATE INDEX IF NOT EXISTS idx_credit_cards_manual_dates 
ON credit_cards(manual_dates_configured) 
WHERE manual_dates_configured = FALSE;