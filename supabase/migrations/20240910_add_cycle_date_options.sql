-- Add fields to support flexible cycle date options
-- Allow users to choose between "same day of month" vs "X days before month end"

ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS cycle_date_type TEXT CHECK (cycle_date_type IN ('same_day', 'days_before_end')) DEFAULT 'same_day';
ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS cycle_days_before_end INTEGER CHECK (cycle_days_before_end >= 0 AND cycle_days_before_end <= 15);
ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS due_date_type TEXT CHECK (due_date_type IN ('same_day', 'days_before_end')) DEFAULT 'same_day';
ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS due_days_before_end INTEGER CHECK (due_days_before_end >= 0 AND due_days_before_end <= 15);

-- Add comments for clarity
COMMENT ON COLUMN credit_cards.cycle_date_type IS 'Type of cycle date calculation: same_day or days_before_end';
COMMENT ON COLUMN credit_cards.cycle_days_before_end IS 'Number of days before month end for cycle close (0-15)';
COMMENT ON COLUMN credit_cards.due_date_type IS 'Type of due date calculation: same_day or days_before_end';
COMMENT ON COLUMN credit_cards.due_days_before_end IS 'Number of days before month end for payment due (0-15)';