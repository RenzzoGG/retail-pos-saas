-- =============================================================================
-- Phase 8: faster RLS reads (same rules, evaluated once per query).
--
-- The SELECT policies called app.is_store_member(store_id) /
-- app.is_store_manager(store_id) for EVERY row. Those helpers are SECURITY
-- DEFINER (they must read store_members), so Postgres can't inline them: a
-- one-year report over 50,000 sales took ~13 s, 20x the same query without RLS.
--
-- Now each policy compares store_id with the set of the caller's stores:
--   store_id in (select app.member_store_ids())
-- The subquery doesn't depend on the row, so Postgres runs it ONCE per query
-- (a hashed subplan) and the check per row is a hash lookup. Same meaning,
-- same tests; the one-year report drops to < 1 s (see docs/DESIGN.md).
-- Write policies are unchanged (they touch one row at a time).
-- =============================================================================

create function app.member_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.store_id from public.store_members m where m.user_id = (select auth.uid());
$$;

create function app.managed_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.store_id from public.store_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'admin');
$$;

revoke execute on function app.member_store_ids(), app.managed_store_ids() from public, anon;
grant execute on function app.member_store_ids(), app.managed_store_ids() to authenticated, service_role;

-- Members (any role) read:
alter policy customers_select_member on public.customers using (store_id in (select app.member_store_ids()));
alter policy products_select_member on public.products using (store_id in (select app.member_store_ids()));
alter policy sales_select_member on public.sales using (store_id in (select app.member_store_ids()));
alter policy sale_items_select_member on public.sale_items using (store_id in (select app.member_store_ids()));
alter policy sale_payments_select_member on public.sale_payments using (store_id in (select app.member_store_ids()));
alter policy returns_select_member on public.returns using (store_id in (select app.member_store_ids()));
alter policy return_items_select_member on public.return_items using (store_id in (select app.member_store_ids()));
alter policy subscriptions_select_member on public.subscriptions using (store_id in (select app.member_store_ids()));

-- Owner/admin read:
alter policy activity_log_select_manager on public.activity_log
  using (store_id is not null and store_id in (select app.managed_store_ids()));
alter policy import_batches_select_manager on public.import_batches using (store_id in (select app.managed_store_ids()));
alter policy invitations_select_manager on public.invitations using (store_id in (select app.managed_store_ids()));
alter policy product_costs_select_manager on public.product_costs using (store_id in (select app.managed_store_ids()));
alter policy sale_item_costs_select_manager on public.sale_item_costs using (store_id in (select app.managed_store_ids()));
alter policy stock_entries_select_manager on public.stock_entries using (store_id in (select app.managed_store_ids()));
alter policy stock_entry_items_select_manager on public.stock_entry_items using (store_id in (select app.managed_store_ids()));
alter policy stock_movements_select_manager on public.stock_movements using (store_id in (select app.managed_store_ids()));
