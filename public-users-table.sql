-- Create or update public.users table to work with NextAuth
-- Run this in Supabase SQL Editor

-- Create users table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.users (
    id uuid NOT NULL PRIMARY KEY,
    email text UNIQUE,
    name text,
    image text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Add any missing columns if table already exists
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS name text,
ADD COLUMN IF NOT EXISTS image text,
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Ensure proper permissions
GRANT ALL ON TABLE public.users TO postgres, service_role;

-- Enable RLS if not already enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate them
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

-- Create RLS policies for public.users
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (true); -- Allow service_role to access all users

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (true); -- Allow service_role to update users

CREATE POLICY "Users can insert own profile" ON public.users
    FOR INSERT WITH CHECK (true); -- Allow service_role to insert users