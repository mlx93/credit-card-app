-- Update cycle date constraints to allow 1-31 for all fields
-- This allows more flexibility for "days before month end" calculations

-- Drop existing constraints
ALTER TABLE credit_cards DROP CONSTRAINT IF EXISTS credit_cards_cycle_days_before_end_check;
ALTER TABLE credit_cards DROP CONSTRAINT IF EXISTS credit_cards_due_days_before_end_check;

-- Add new constraints with 1-31 range
ALTER TABLE credit_cards ADD CONSTRAINT credit_cards_cycle_days_before_end_check 
  CHECK (cycle_days_before_end >= 1 AND cycle_days_before_end <= 31);

ALTER TABLE credit_cards ADD CONSTRAINT credit_cards_due_days_before_end_check 
  CHECK (due_days_before_end >= 1 AND due_days_before_end <= 31);

-- Update comments to reflect new ranges
COMMENT ON COLUMN credit_cards.cycle_days_before_end IS 'Number of days before month end for cycle close (1-31)';
COMMENT ON COLUMN credit_cards.due_days_before_end IS 'Number of days before month end for payment due (1-31)';