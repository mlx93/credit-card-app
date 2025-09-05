-- Persistence for user-defined card order and lightweight sync telemetry

-- Store card order as an array of credit card UUIDs per user
create table if not exists public.user_card_orders (
  user_id uuid primary key references next_auth.users(id) on delete cascade,
  order_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_card_orders enable row level security;

-- RLS: Users can manage only their own order
create policy if not exists "select own order" on public.user_card_orders
  for select using (next_auth.uid() = user_id);

create policy if not exists "upsert own order" on public.user_card_orders
  for insert with check (next_auth.uid() = user_id);

create policy if not exists "update own order" on public.user_card_orders
  for update using (next_auth.uid() = user_id);

-- Getter RPC
create or replace function public.get_card_order()
returns uuid[]
language sql
security definer
set search_path = public
as $$
  select coalesce(order_ids, '{}') from public.user_card_orders where user_id = next_auth.uid();
$$;

-- Setter RPC
create or replace function public.set_card_order(p_order uuid[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_card_orders(user_id, order_ids, updated_at)
  values (next_auth.uid(), p_order, now())
  on conflict (user_id) do update set order_ids = excluded.order_ids, updated_at = now();
  return true;
exception when others then
  return false;
end;
$$;

-- Lightweight telemetry for daily sync gating
create table if not exists public.user_sync_telemetry (
  id bigserial primary key,
  user_id uuid references next_auth.users(id) on delete cascade,
  event text not null, -- e.g., 'daily_sync_check', 'daily_sync_run'
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.user_sync_telemetry enable row level security;

create policy if not exists "insert own telemetry" on public.user_sync_telemetry
  for insert with check (next_auth.uid() = user_id);

create policy if not exists "select own telemetry" on public.user_sync_telemetry
  for select using (next_auth.uid() = user_id);

