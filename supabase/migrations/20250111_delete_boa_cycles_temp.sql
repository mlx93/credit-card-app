-- Temporary: Delete Bank of America billing cycles to allow regeneration
-- This is a one-time fix to clear incorrect statementBalance values

-- Delete all billing cycles for cards with "Custom" and "Cash" in the name
DELETE FROM billing_cycles
WHERE (LOWER(creditCardName) LIKE '%custom%' AND LOWER(creditCardName) LIKE '%cash%')
   OR LOWER(creditCardName) LIKE '%customized cash%';

-- Log what was deleted
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % billing cycles for Bank of America Custom Cash card', deleted_count;
END $$;