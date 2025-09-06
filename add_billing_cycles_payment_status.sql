-- Add paymentStatus to billing_cycles if it does not exist
-- Allowed values: current, due, paid, outstanding

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'billing_cycles'
      and column_name  = 'paymentstatus'
  ) then
    alter table public.billing_cycles
      add column paymentStatus text;

    -- Optional: add a CHECK constraint for known values
    begin
      alter table public.billing_cycles
        add constraint billing_cycles_paymentstatus_check
        check (paymentStatus is null or paymentStatus in ('current','due','paid','outstanding'));
    exception when others then
      -- If constraint already exists or other issue, ignore
      null;
    end;
  end if;
end$$;

