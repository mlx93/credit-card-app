-- Enable Row Level Security (RLS) for Credit Card Application
-- Run this SQL in your Supabase SQL Editor

-- 1. Enable RLS on all financial tables
ALTER TABLE plaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprs ENABLE ROW LEVEL SECURITY;

-- 2. Create a helper function to get the current user's ID from session
-- This works with NextAuth sessions
CREATE OR REPLACE FUNCTION auth.get_user_id() RETURNS uuid AS $$
DECLARE
  user_id uuid;
BEGIN
  -- Try to get user ID from JWT claims (for authenticated requests)
  SELECT next_auth.uid() INTO user_id;
  
  -- If that fails, try to get from current setting (for service role with user context)
  IF user_id IS NULL THEN
    user_id := current_setting('app.current_user_id', true)::uuid;
  END IF;
  
  RETURN user_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. RLS Policies for plaid_items table
-- Users can only access their own Plaid connections
CREATE POLICY "Users can view own plaid items" ON plaid_items
    FOR SELECT 
    USING (
        "userId" = auth.get_user_id() 
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can insert own plaid items" ON plaid_items
    FOR INSERT 
    WITH CHECK (
        "userId" = auth.get_user_id() 
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can update own plaid items" ON plaid_items
    FOR UPDATE 
    USING (
        "userId" = auth.get_user_id() 
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can delete own plaid items" ON plaid_items
    FOR DELETE 
    USING (
        "userId" = auth.get_user_id() 
        OR current_setting('role') = 'service_role'
    );

-- 4. RLS Policies for credit_cards table
-- Users can only access credit cards from their own Plaid items
CREATE POLICY "Users can view own credit cards" ON credit_cards
    FOR SELECT 
    USING (
        "plaidItemId" IN (
            SELECT id FROM plaid_items WHERE "userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can insert own credit cards" ON credit_cards
    FOR INSERT 
    WITH CHECK (
        "plaidItemId" IN (
            SELECT id FROM plaid_items WHERE "userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can update own credit cards" ON credit_cards
    FOR UPDATE 
    USING (
        "plaidItemId" IN (
            SELECT id FROM plaid_items WHERE "userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can delete own credit cards" ON credit_cards
    FOR DELETE 
    USING (
        "plaidItemId" IN (
            SELECT id FROM plaid_items WHERE "userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

-- 5. RLS Policies for transactions table
-- Users can only access transactions from their own credit cards
CREATE POLICY "Users can view own transactions" ON transactions
    FOR SELECT 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can insert own transactions" ON transactions
    FOR INSERT 
    WITH CHECK (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can update own transactions" ON transactions
    FOR UPDATE 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can delete own transactions" ON transactions
    FOR DELETE 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

-- 6. RLS Policies for billing_cycles table
-- Users can only access billing cycles from their own credit cards
CREATE POLICY "Users can view own billing cycles" ON billing_cycles
    FOR SELECT 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can insert own billing cycles" ON billing_cycles
    FOR INSERT 
    WITH CHECK (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can update own billing cycles" ON billing_cycles
    FOR UPDATE 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can delete own billing cycles" ON billing_cycles
    FOR DELETE 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

-- 7. RLS Policies for aprs table
-- Users can only access APR data from their own credit cards
CREATE POLICY "Users can view own aprs" ON aprs
    FOR SELECT 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can insert own aprs" ON aprs
    FOR INSERT 
    WITH CHECK (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can update own aprs" ON aprs
    FOR UPDATE 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can delete own aprs" ON aprs
    FOR DELETE 
    USING (
        "creditCardId" IN (
            SELECT cc.id FROM credit_cards cc
            JOIN plaid_items pi ON cc."plaidItemId" = pi.id
            WHERE pi."userId" = auth.get_user_id()
        )
        OR current_setting('role') = 'service_role'
    );

-- 8. Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON plaid_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON credit_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON aprs TO authenticated;

-- 9. Ensure service role can still access everything (for your API routes)
-- This is already enabled by default, but we're being explicit
GRANT ALL ON plaid_items TO service_role;
GRANT ALL ON credit_cards TO service_role;
GRANT ALL ON transactions TO service_role;
GRANT ALL ON billing_cycles TO service_role;
GRANT ALL ON aprs TO service_role;

-- 10. Create indexes to optimize RLS policy performance
CREATE INDEX IF NOT EXISTS idx_plaid_items_user_id ON plaid_items("userId");
CREATE INDEX IF NOT EXISTS idx_credit_cards_plaid_item_id ON credit_cards("plaidItemId");
CREATE INDEX IF NOT EXISTS idx_transactions_credit_card_id ON transactions("creditCardId");
CREATE INDEX IF NOT EXISTS idx_billing_cycles_credit_card_id ON billing_cycles("creditCardId");
CREATE INDEX IF NOT EXISTS idx_aprs_credit_card_id ON aprs("creditCardId");

-- Success message
SELECT 'RLS policies successfully enabled for all financial tables!' AS status;