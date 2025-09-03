-- Fix search_path security issue for get_current_user_id function
-- Run this SQL in your Supabase SQL Editor

-- Update the existing function with secure search_path (no DROP needed)
CREATE OR REPLACE FUNCTION public.get_current_user_id() RETURNS uuid AS $$
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
$$ LANGUAGE plpgsql 
   STABLE 
   SECURITY DEFINER 
   SET search_path = public, next_auth;

-- Success message
SELECT 'Function search_path security issue fixed!' AS status;