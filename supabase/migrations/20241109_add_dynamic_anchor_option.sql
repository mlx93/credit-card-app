-- Add dynamic_anchor option to cycle_date_type and due_date_type enums
-- This enables Amex-style dynamic anchor date billing cycles

-- Update cycle_date_type to include dynamic_anchor
ALTER TABLE credit_cards DROP CONSTRAINT IF EXISTS credit_cards_cycle_date_type_check;
ALTER TABLE credit_cards ADD CONSTRAINT credit_cards_cycle_date_type_check 
  CHECK (cycle_date_type IN ('same_day', 'days_before_end', 'dynamic_anchor'));

-- Update due_date_type to include dynamic_anchor  
ALTER TABLE credit_cards DROP CONSTRAINT IF EXISTS credit_cards_due_date_type_check;
ALTER TABLE credit_cards ADD CONSTRAINT credit_cards_due_date_type_check 
  CHECK (due_date_type IN ('same_day', 'days_before_end', 'dynamic_anchor'));

-- Update comments to reflect new option
COMMENT ON COLUMN credit_cards.cycle_date_type IS 'Type of cycle date calculation: same_day, days_before_end, or dynamic_anchor';
COMMENT ON COLUMN credit_cards.due_date_type IS 'Type of due date calculation: same_day, days_before_end, or dynamic_anchor';

-- Add index for better performance on dynamic_anchor cards
CREATE INDEX IF NOT EXISTS idx_credit_cards_dynamic_anchor 
ON credit_cards(cycle_date_type) 
WHERE cycle_date_type = 'dynamic_anchor';