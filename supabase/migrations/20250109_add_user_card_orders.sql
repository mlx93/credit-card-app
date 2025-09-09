-- Persistence for user-defined card order and lightweight sync telemetry

-- Store card order as an array of credit card UUIDs per user
create table if not exists public.user_card_orders (
  user_id uuid primary key references public.users(id) on delete cascade,
  order_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_card_orders enable row level security;

-- RLS: Users can manage only their own order (idempotent via drop/create)
drop policy if exists "select own order" on public.user_card_orders;
create policy "select own order" on public.user_card_orders
  for select using (auth.uid() = user_id);

drop policy if exists "upsert own order" on public.user_card_orders;
create policy "upsert own order" on public.user_card_orders
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own order" on public.user_card_orders;
create policy "update own order" on public.user_card_orders
  for update using (auth.uid() = user_id);

-- Getter RPC
create or replace function public.get_card_order()
returns uuid[]
language sql
security definer
set search_path = public
as $$
  select coalesce(order_ids, '{}') from public.user_card_orders where user_id = auth.uid();
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
  values (auth.uid(), p_order, now())
  on conflict (user_id) do update set order_ids = excluded.order_ids, updated_at = now();
  return true;
exception when others then
  return false;
end;
$$;

-- Store lightweight sync telemetry
create table if not exists public.sync_telemetry (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id text not null references public.plaid_items(id) on delete cascade,
  trigger_source text not null check (trigger_source in ('manual', 'webhook', 'automatic')),
  sync_type text not null check (sync_type in ('instant', 'comprehensive', 'fast', 'update', 'reconnection')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  success boolean,
  error_message text,
  cards_synced integer default 0,
  transactions_synced integer default 0,
  created_at timestamptz not null default now()
);

-- Index for efficient queries
create index if not exists idx_sync_telemetry_plaid_item_id on public.sync_telemetry(plaid_item_id);
create index if not exists idx_sync_telemetry_started_at on public.sync_telemetry(started_at desc);

alter table public.sync_telemetry enable row level security;

-- RLS: Users can view telemetry for their own items (idempotent via drop/create)
drop policy if exists "view own telemetry" on public.sync_telemetry;
create policy "view own telemetry" on public.sync_telemetry
  for select using (
    exists (
      select 1 from public.plaid_items
      where plaid_items.id = sync_telemetry.plaid_item_id
      and plaid_items."userId" = auth.uid()
    )
  );