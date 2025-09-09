-- Delete all billing cycles for Bank of America Custom Cash card
-- This will allow them to be regenerated with correct statementBalance values

-- First, let's identify the card and see what we're deleting
SELECT 
  bc.id,
  bc.creditCardName,
  bc.startDate,
  bc.endDate,
  bc.statementBalance,
  bc.totalSpend
FROM billing_cycles bc
WHERE bc.creditCardName ILIKE '%custom%cash%'
   OR bc.creditCardName ILIKE '%bank of america%'
   OR bc.creditCardName ILIKE '%boa%'
ORDER BY bc.endDate DESC;

-- Delete the billing cycles for this card
-- IMPORTANT: Uncomment the DELETE statement below after verifying the SELECT shows the right cycles
-- DELETE FROM billing_cycles
-- WHERE creditCardName ILIKE '%custom%cash%'
--    OR creditCardName ILIKE '%bank of america%'
--    OR creditCardName ILIKE '%boa%';

-- Alternative: Delete by creditCardId if you know the exact ID
-- First find the card ID:
SELECT id, name, mask 
FROM credit_cards 
WHERE name ILIKE '%custom%cash%'
   OR name ILIKE '%bank of america%';

-- Then delete by ID (replace 'YOUR_CARD_ID' with the actual ID):
-- DELETE FROM billing_cycles WHERE creditCardId = 'YOUR_CARD_ID';