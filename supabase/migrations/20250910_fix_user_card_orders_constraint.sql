-- Fix user_card_orders foreign key constraint violations
-- This handles cases where session.user.id doesn't exist in public.users table

-- First, check if there are any orphaned records and remove them
DELETE FROM public.user_card_orders 
WHERE user_id NOT IN (SELECT id FROM public.users);

-- Add a function to ensure user exists before inserting card order
CREATE OR REPLACE FUNCTION public.ensure_user_exists_for_card_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user exists in public.users table
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.user_id) THEN
    -- Try to get user info from auth.users (if using Supabase Auth)
    -- or create a minimal user record
    INSERT INTO public.users (id, created_at, updated_at)
    VALUES (NEW.user_id, now(), now())
    ON CONFLICT (id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Add trigger to ensure user exists before inserting/updating card orders
DROP TRIGGER IF EXISTS ensure_user_exists_card_order ON public.user_card_orders;
CREATE TRIGGER ensure_user_exists_card_order
  BEFORE INSERT OR UPDATE ON public.user_card_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_user_exists_for_card_order();

-- Add a helper function for the API to safely upsert card orders
CREATE OR REPLACE FUNCTION public.safe_upsert_card_order(p_user_id uuid, p_order uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure user exists first
  INSERT INTO public.users (id, created_at, updated_at)
  VALUES (p_user_id, now(), now())
  ON CONFLICT (id) DO NOTHING;
  
  -- Now safely upsert the card order
  INSERT INTO public.user_card_orders(user_id, order_ids, updated_at)
  VALUES (p_user_id, p_order, now())
  ON CONFLICT (user_id) DO UPDATE SET 
    order_ids = excluded.order_ids, 
    updated_at = now();
    
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't crash
  RAISE WARNING 'Error upserting card order for user %: %', p_user_id, SQLERRM;
  RETURN false;
END;
$$;