-- Atomic delete functions for Plaid items and single credit cards
-- Run in Supabase SQL editor (or via migration) before enabling RPC usage

create or replace function public.delete_plaid_item_and_data(p_plaid_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_ids uuid[];
begin
  -- Collect card ids up front
  select coalesce(array_agg(id), '{}') into v_card_ids
  from credit_cards
  where plaidItemId = p_plaid_item_id;

  -- Remove dependent data first
  if array_length(v_card_ids, 1) is not null then
    delete from aprs where creditCardId = any(v_card_ids);
    delete from billing_cycles where creditCardId = any(v_card_ids);
    delete from transactions where creditCardId = any(v_card_ids);
  end if;

  -- Remove cards
  delete from credit_cards where plaidItemId = p_plaid_item_id;

  -- Remove the plaid item
  delete from plaid_items where id = p_plaid_item_id;

  return true;
exception when others then
  raise notice 'delete_plaid_item_and_data failed: %', sqlerrm;
  return false;
end;
$$;

comment on function public.delete_plaid_item_and_data(uuid) is 'Deletes all data for a Plaid item in a single transaction (aprs, billing_cycles, transactions, credit_cards, plaid_items). Returns true on success.';


create or replace function public.delete_credit_card_and_data(p_credit_card_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_remaining int;
begin
  -- Find parent item
  select plaidItemId into v_item_id from credit_cards where id = p_credit_card_id;

  -- Delete dependent data
  delete from aprs where creditCardId = p_credit_card_id;
  delete from billing_cycles where creditCardId = p_credit_card_id;
  delete from transactions where creditCardId = p_credit_card_id;

  -- Delete the card itself
  delete from credit_cards where id = p_credit_card_id;

  -- Optionally delete the plaid item if this was the last card under it
  if v_item_id is not null then
    select count(*) into v_remaining from credit_cards where plaidItemId = v_item_id;
    if v_remaining = 0 then
      delete from plaid_items where id = v_item_id;
    end if;
  end if;

  return true;
exception when others then
  raise notice 'delete_credit_card_and_data failed: %', sqlerrm;
  return false;
end;
$$;

comment on function public.delete_credit_card_and_data(uuid) is 'Deletes a single credit card and all dependent data; if no cards remain under the Plaid item, deletes the item as well. Returns true on success.';

