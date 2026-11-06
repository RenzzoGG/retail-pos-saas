-- =============================================================================
-- Phase 9: access by subscription state, and Stripe webhook events.
--
-- Access per store (app.store_access):
--   no subscription row, or 'incomplete'          -> 'setup'     (set up the store, can't sell)
--   'trialing', 'active', 'past_due'              -> 'full'      (past_due shows a warning in the app)
--   'canceled', 'unpaid', 'incomplete_expired',
--   'paused'                                      -> 'read_only' (view, reports, export; Billing,
--                                                                 Settings and Team still work)
--
-- Enforced in the database with BEFORE triggers on the business tables, so every
-- write path is covered (the SECURITY DEFINER functions create_sale,
-- create_return, create_stock_entry, import_products... and the RLS-checked
-- inserts/updates) without rewriting those functions:
--   sales, returns                                  -> need 'full'      ("sell")
--   products, product_costs, stock_entries,
--   import_batches, customers                       -> 'full' or 'setup' ("edit")
-- The guard only applies to signed-in users (auth.uid() is set). The Stripe
-- webhook (service_role) and the local seed/migrations (postgres) are not users.
-- =============================================================================

create function app.store_access(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.status is null or s.status = 'incomplete' then 'setup'
    when s.status in ('trialing', 'active', 'past_due') then 'full'
    else 'read_only'
  end
  from (select 1) as one
  left join public.subscriptions s on s.store_id = p_store_id;
$$;

create function app.guard_subscription_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_need constant text := tg_argv[0]; -- 'sell' or 'edit'
  v_store uuid;
  v_access text;
begin
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;
  v_store := case when tg_op = 'DELETE' then old.store_id else new.store_id end;
  v_access := app.store_access(v_store);
  if v_access = 'full' or (v_need = 'edit' and v_access = 'setup') then
    return coalesce(new, old);
  end if;
  raise exception 'subscription_inactive' using errcode = '42501', hint = v_access;
end;
$$;

create trigger sales_subscription_guard before insert or update or delete on public.sales
  for each row execute function app.guard_subscription_access('sell');
create trigger returns_subscription_guard before insert or update or delete on public.returns
  for each row execute function app.guard_subscription_access('sell');
create trigger products_subscription_guard before insert or update or delete on public.products
  for each row execute function app.guard_subscription_access('edit');
create trigger product_costs_subscription_guard before insert or update or delete on public.product_costs
  for each row execute function app.guard_subscription_access('edit');
create trigger stock_entries_subscription_guard before insert or update or delete on public.stock_entries
  for each row execute function app.guard_subscription_access('edit');
create trigger import_batches_subscription_guard before insert or update or delete on public.import_batches
  for each row execute function app.guard_subscription_access('edit');
create trigger customers_subscription_guard before insert or update or delete on public.customers
  for each row execute function app.guard_subscription_access('edit');

-- -----------------------------------------------------------------------------
-- Stripe webhook: record + apply an event atomically (service_role only).
--
--   p_change (built by the server from the verified event) may contain:
--     store_id, customer_id, subscription_id, status, price_id, trial_end,
--     current_period_end, cancel_at_period_end. Only the keys present are set.
--
--   Returns:
--     'duplicate' -> this event id was already recorded: nothing is done (idempotency)
--     'ignored'   -> no store (unknown or missing id) or nothing to apply
--     'stale'     -> a newer state-changing event was already applied (out-of-order delivery)
--     'processed' -> applied
--
-- Everything runs in one transaction: if applying fails, the event is not
-- recorded either, the route answers 500 and Stripe retries it.
-- Only events that carry a status advance last_event_at: checkout.session.completed
-- only links the Stripe ids, so it can't make a later-delivered (but earlier
-- created) customer.subscription.created look stale.
-- -----------------------------------------------------------------------------
create function public.apply_stripe_event(
  p_event_id text,
  p_type text,
  p_created timestamptz,
  p_change jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_store uuid;
  v_last timestamptz;
  v_has_status boolean := coalesce(p_change ? 'status', false);
  v_result text;
begin
  insert into public.stripe_events (id, type) values (p_event_id, p_type) on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  v_store := nullif(p_change ->> 'store_id', '')::uuid;
  if v_store is null or not exists (select 1 from public.stores where id = v_store) then
    v_result := 'ignored';
  else
    select s.last_event_at into v_last from public.subscriptions s where s.store_id = v_store;
    if v_has_status and v_last is not null and p_created < v_last then
      v_result := 'stale';
    else
      insert into public.subscriptions as s (
        store_id, stripe_customer_id, stripe_subscription_id, status, price_id, trial_end,
        current_period_end, cancel_at_period_end, last_event_at
      )
      values (
        v_store,
        p_change ->> 'customer_id',
        p_change ->> 'subscription_id',
        coalesce((p_change ->> 'status')::public.subscription_status, 'incomplete'),
        p_change ->> 'price_id',
        (p_change ->> 'trial_end')::timestamptz,
        (p_change ->> 'current_period_end')::timestamptz,
        coalesce((p_change ->> 'cancel_at_period_end')::boolean, false),
        case when v_has_status then p_created end
      )
      on conflict (store_id) do update set
        stripe_customer_id = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, s.stripe_subscription_id),
        status = case when v_has_status then excluded.status else s.status end,
        price_id = case when p_change ? 'price_id' then excluded.price_id else s.price_id end,
        trial_end = case when p_change ? 'trial_end' then excluded.trial_end else s.trial_end end,
        current_period_end = case when p_change ? 'current_period_end' then excluded.current_period_end else s.current_period_end end,
        cancel_at_period_end = case when p_change ? 'cancel_at_period_end' then excluded.cancel_at_period_end else s.cancel_at_period_end end,
        last_event_at = case when v_has_status then p_created else s.last_event_at end;
      v_result := 'processed';
    end if;
  end if;

  update public.stripe_events set processed_at = now(), result = v_result where id = p_event_id;
  return v_result;
end;
$$;

revoke execute on function app.store_access(uuid) from public, anon;
grant execute on function app.store_access(uuid) to authenticated, service_role;
revoke execute on function app.guard_subscription_access() from public, anon, authenticated;
revoke execute on function public.apply_stripe_event(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text, text, timestamptz, jsonb) to service_role;
