-- Enable RLS for remaining NextAuth tables
-- Run this SQL in your Supabase SQL Editor

-- 1. Enable RLS on NextAuth tables in public schema
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_tokens ENABLE ROW LEVEL SECURITY;

-- Also handle the table with different naming convention if it exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verificationtokens') THEN
    EXECUTE 'ALTER TABLE public.verificationtokens ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- 2. Create RLS policies for accounts table
-- Accounts contain OAuth provider information - users should only see their own
CREATE POLICY "Users can view own accounts" ON public.accounts
    FOR SELECT 
    USING (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can insert own accounts" ON public.accounts
    FOR INSERT 
    WITH CHECK (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can update own accounts" ON public.accounts
    FOR UPDATE 
    USING (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can delete own accounts" ON public.accounts
    FOR DELETE 
    USING (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

-- 3. Create RLS policies for sessions table
-- Sessions should only be accessible to the owning user
CREATE POLICY "Users can view own sessions" ON public.sessions
    FOR SELECT 
    USING (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can insert own sessions" ON public.sessions
    FOR INSERT 
    WITH CHECK (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can update own sessions" ON public.sessions
    FOR UPDATE 
    USING (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

CREATE POLICY "Users can delete own sessions" ON public.sessions
    FOR DELETE 
    USING (
        "userId" = public.get_current_user_id()
        OR current_setting('role') = 'service_role'
    );

-- 4. Create RLS policies for verification_tokens table
-- Verification tokens don't have a userId, so we need different logic
-- Allow service role full access, and authenticated users can only access tokens they created
-- Note: This is tricky because tokens are typically accessed before authentication
CREATE POLICY "Service role can manage verification tokens" ON public.verification_tokens
    FOR ALL 
    USING (current_setting('role') = 'service_role');

-- Allow anyone to insert verification tokens (needed for signup/email verification)
CREATE POLICY "Anyone can insert verification tokens" ON public.verification_tokens
    FOR INSERT 
    WITH CHECK (true);

-- Allow anyone to select verification tokens by identifier (needed for token validation)
CREATE POLICY "Anyone can select verification tokens by identifier" ON public.verification_tokens
    FOR SELECT 
    USING (true);

-- Allow anyone to delete verification tokens (needed for cleanup after use)
CREATE POLICY "Anyone can delete used verification tokens" ON public.verification_tokens
    FOR DELETE 
    USING (true);

-- 5. Handle verificationtokens table (different naming) if it exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verificationtokens') THEN
    -- Create similar policies for verificationtokens (different naming convention)
    EXECUTE 'CREATE POLICY "Service role can manage verificationtokens" ON public.verificationtokens FOR ALL USING (current_setting(''role'') = ''service_role'')';
    EXECUTE 'CREATE POLICY "Anyone can insert verificationtokens" ON public.verificationtokens FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Anyone can select verificationtokens" ON public.verificationtokens FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY "Anyone can delete verificationtokens" ON public.verificationtokens FOR DELETE USING (true)';
  END IF;
END $$;

-- 6. Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.verification_tokens TO authenticated;

-- Handle verificationtokens table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verificationtokens') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON public.verificationtokens TO authenticated';
  END IF;
END $$;

-- Ensure service role maintains full access
GRANT ALL ON public.accounts TO service_role;
GRANT ALL ON public.sessions TO service_role;
GRANT ALL ON public.verification_tokens TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verificationtokens') THEN
    EXECUTE 'GRANT ALL ON public.verificationtokens TO service_role';
  END IF;
END $$;

-- 7. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts("userId");
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions("userId");
CREATE INDEX IF NOT EXISTS idx_verification_tokens_identifier ON public.verification_tokens(identifier);

DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verificationtokens') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_verificationtokens_identifier ON public.verificationtokens(identifier)';
  END IF;
END $$;

-- Success message
SELECT 'RLS policies successfully enabled for all NextAuth tables!' AS status;