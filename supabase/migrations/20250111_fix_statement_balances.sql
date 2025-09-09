-- Fix incorrect statement balances in billing_cycles
-- The issue: statementBalance was incorrectly set to Plaid's lastStatementBalance for ALL cycles
-- The fix: Set statementBalance equal to totalSpend for cycles that don't match the statement date

-- For now, since we don't have the exact statement dates in the migration,
-- we'll use a heuristic: if multiple cycles have the same statementBalance, 
-- only keep it for the oldest one and use totalSpend for the others

-- First, identify duplicate statement balances per credit card
WITH duplicate_balances AS (
  SELECT 
    creditCardId,
    statementBalance,
    COUNT(*) as cycle_count
  FROM billing_cycles
  WHERE statementBalance IS NOT NULL 
    AND statementBalance > 0
  GROUP BY creditCardId, statementBalance
  HAVING COUNT(*) > 1
),
-- For each duplicate, keep the statement balance only for the oldest cycle
cycles_to_update AS (
  SELECT 
    bc.id,
    bc.creditCardId,
    bc.statementBalance,
    bc.totalSpend,
    bc.endDate,
    ROW_NUMBER() OVER (
      PARTITION BY bc.creditCardId, bc.statementBalance 
      ORDER BY bc.endDate ASC
    ) as rn
  FROM billing_cycles bc
  INNER JOIN duplicate_balances db 
    ON bc.creditCardId = db.creditCardId 
    AND bc.statementBalance = db.statementBalance
)
-- Update all but the oldest cycle to use totalSpend as statementBalance
UPDATE billing_cycles
SET 
  statementBalance = totalSpend,
  updatedAt = NOW()
FROM cycles_to_update
WHERE billing_cycles.id = cycles_to_update.id
  AND cycles_to_update.rn > 1;

-- Also update any cycles where statementBalance is null or 0 to use totalSpend
UPDATE billing_cycles
SET 
  statementBalance = totalSpend,
  updatedAt = NOW()
WHERE (statementBalance IS NULL OR statementBalance = 0)
  AND totalSpend > 0;

-- Log the results
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % billing cycles with incorrect statement balances', updated_count;
END $$;