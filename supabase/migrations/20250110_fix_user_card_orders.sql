-- Fix user_card_orders table to remove invalid foreign key constraint
-- Users are tracked via plaid_items.userId, not a separate users table

-- Drop the existing table with the bad foreign key
DROP TABLE IF EXISTS public.user_card_orders CASCADE;

-- Recreate without foreign key constraint (user_id is just a UUID)
CREATE TABLE public.user_card_orders (
  user_id uuid PRIMARY KEY, -- No foreign key, just store the user ID
  order_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_card_orders ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "select own order" ON public.user_card_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "upsert own order" ON public.user_card_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update own order" ON public.user_card_orders
  FOR UPDATE USING (auth.uid() = user_id);

-- Recreate the getter function
CREATE OR REPLACE FUNCTION public.get_card_order()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT order_ids 
  FROM user_card_orders 
  WHERE user_id = auth.uid();
$$;

-- Recreate the setter function
CREATE OR REPLACE FUNCTION public.set_card_order(order_array uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO user_card_orders (user_id, order_ids, updated_at)
  VALUES (auth.uid(), order_array, now())
  ON CONFLICT (user_id) 
  DO UPDATE SET order_ids = EXCLUDED.order_ids, updated_at = EXCLUDED.updated_at;
$$;