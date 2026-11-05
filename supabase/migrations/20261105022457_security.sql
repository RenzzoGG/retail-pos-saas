-- =============================================================================
-- Security: helper functions, privileges and Row Level Security policies.
--
-- How access is decided (defense in depth, every layer must allow the action):
--   1. GRANTs (table/column privileges): what a role may do at all.
--      anon gets nothing; authenticated only what the app needs; columns such
--      as products.stock or stores.last_sale_number are never writable.
--   2. RLS policies: which ROWS a role may see (USING) or write (WITH CHECK).
--      Every table has RLS enabled; no policy = no access (deny by default).
--   3. SECURITY DEFINER functions (functions migration): the only way to write
--      sales, returns, stock entries and stock.
--
-- The service_role key (server only: Stripe webhook, seeds) bypasses RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Private schema for helpers. It is NOT in the PostgREST exposed schemas
-- (supabase/config.toml -> api.schemas), so nothing here is callable as /rpc.
-- -----------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Is the current user a member of the store (any role)?
--
-- SECURITY DEFINER: runs with the owner's (postgres) privileges, so it can read
-- store_members without triggering that table's own RLS policies. Without it,
-- the store_members SELECT policy (which needs to know your memberships) would
-- recurse into itself forever. It is also cheaper than nested RLS checks.
--
-- Why this is safe:
--   * It only answers about the CALLER: the user comes from auth.uid() (the
--     verified JWT), never from a parameter, so it cannot be used to probe
--     other users' memberships.
--   * search_path = '' and fully-qualified names (public.store_members,
--     auth.uid) prevent search_path hijacking: a malicious object named
--     "store_members" in another schema can never be picked up.
--   * It returns only a boolean and lives in the unexposed "app" schema.
--   * EXECUTE is revoked from PUBLIC/anon below.
create function app.is_store_member(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = (select auth.uid())
  );
$$;

-- Does the current user have one of the given roles in the store?
create function app.has_store_role(p_store_id uuid, p_roles public.store_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- Shortcut: owner or admin ("managers" in the docs).
create function app.is_store_manager(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_store_role(p_store_id, array['owner', 'admin']::public.store_role[]);
$$;

-- Does the current user share at least one store with p_user_id? (profiles)
create function app.shares_store_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members mine
    join public.store_members theirs on theirs.store_id = mine.store_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges. Supabase grants ALL on new public tables to anon/authenticated by
-- default; we start from zero and grant only what is needed.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Future tables created by migrations will not be granted to anon automatically.
-- (They still need RLS: the pgTAP test fails if any public table lacks it.)
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- Column-level privileges: authenticated can only write the listed columns.
-- id, store_id (on update), stock, created_by, timestamps and counters are
-- never client-writable; triggers fill created_by/updated_at.
grant select on public.stores to authenticated;
grant update (name, currency, tax_rate, prices_include_tax, ticket_footer)
  on public.stores to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select, delete on public.store_members to authenticated;
grant insert (store_id, user_id, role) on public.store_members to authenticated;
grant update (role) on public.store_members to authenticated;

grant select, delete on public.invitations to authenticated;
grant insert (store_id, email, role, token_hash, expires_at) on public.invitations to authenticated;

grant select on public.products to authenticated;
grant insert (store_id, sku, barcode, name, category, sale_price, low_stock_threshold, active)
  on public.products to authenticated;
grant update (sku, barcode, name, category, sale_price, low_stock_threshold, active, deleted_at)
  on public.products to authenticated;

grant select on public.product_costs to authenticated;
grant insert (product_id, store_id, cost_price) on public.product_costs to authenticated;
grant update (cost_price) on public.product_costs to authenticated;

grant select on public.stock_entries, public.stock_entry_items, public.stock_movements
  to authenticated;

grant select, delete on public.customers to authenticated;
grant insert (store_id, name, document_id, phone, email, notes) on public.customers to authenticated;
grant update (name, document_id, phone, email, notes) on public.customers to authenticated;

grant select on public.sales, public.sale_items, public.sale_item_costs, public.sale_payments,
  public.returns, public.return_items
  to authenticated;

grant select on public.activity_log to authenticated;
grant select on public.subscriptions to authenticated;
-- public.stripe_events: no grants at all (service_role only).

-- -----------------------------------------------------------------------------
-- Enable RLS on every table (explicit list on purpose: easy to review).
-- -----------------------------------------------------------------------------
alter table public.stores            enable row level security;
alter table public.profiles          enable row level security;
alter table public.store_members     enable row level security;
alter table public.invitations       enable row level security;
alter table public.products          enable row level security;
alter table public.product_costs     enable row level security;
alter table public.stock_entries     enable row level security;
alter table public.stock_entry_items enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.customers         enable row level security;
alter table public.sales             enable row level security;
alter table public.sale_items        enable row level security;
alter table public.sale_item_costs   enable row level security;
alter table public.sale_payments     enable row level security;
alter table public.returns           enable row level security;
alter table public.return_items      enable row level security;
alter table public.activity_log      enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.stripe_events     enable row level security;

-- -----------------------------------------------------------------------------
-- Policies. All are "to authenticated"; anon has no policy (and no grants).
--   USING      -> filters which existing rows are visible/updatable/deletable.
--   WITH CHECK -> validates the NEW row on insert/update (reject = error 42501).
-- -----------------------------------------------------------------------------

-- stores: members read; owner/admin edit configuration. Creation comes in
-- phase 3 through a function that also creates the owner membership.
create policy stores_select_member on public.stores
  for select to authenticated
  using (app.is_store_member(id));

create policy stores_update_manager on public.stores
  for update to authenticated
  using (app.is_store_manager(id))
  with check (app.is_store_manager(id));

-- profiles: yourself and people you share a store with. Created by trigger.
create policy profiles_select_self_or_coworker on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app.shares_store_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- store_members: members see the team. Owners manage everyone; admins manage
-- admins/cashiers but can neither touch owners nor create/promote owners.
create policy store_members_select_member on public.store_members
  for select to authenticated
  using (app.is_store_member(store_id));

create policy store_members_insert_manager on public.store_members
  for insert to authenticated
  with check (
    app.has_store_role(store_id, array['owner']::public.store_role[])
    or (app.has_store_role(store_id, array['admin']::public.store_role[]) and role <> 'owner')
  );

create policy store_members_update_manager on public.store_members
  for update to authenticated
  using (
    app.has_store_role(store_id, array['owner']::public.store_role[])
    or (app.has_store_role(store_id, array['admin']::public.store_role[]) and role <> 'owner')
  )
  with check (
    app.has_store_role(store_id, array['owner']::public.store_role[])
    or (app.has_store_role(store_id, array['admin']::public.store_role[]) and role <> 'owner')
  );

create policy store_members_delete_manager on public.store_members
  for delete to authenticated
  using (
    app.has_store_role(store_id, array['owner']::public.store_role[])
    or (app.has_store_role(store_id, array['admin']::public.store_role[]) and role <> 'owner')
  );

-- invitations: only owner/admin (the table CHECK forbids inviting owners).
create policy invitations_select_manager on public.invitations
  for select to authenticated
  using (app.is_store_manager(store_id));

create policy invitations_insert_manager on public.invitations
  for insert to authenticated
  with check (app.is_store_manager(store_id));

create policy invitations_delete_manager on public.invitations
  for delete to authenticated
  using (app.is_store_manager(store_id));

-- products: every member reads (the POS needs name/price/stock); only
-- owner/admin create and edit. No DELETE: products are soft-deleted
-- (deleted_at) so past sales keep their references.
create policy products_select_member on public.products
  for select to authenticated
  using (app.is_store_member(store_id));

create policy products_insert_manager on public.products
  for insert to authenticated
  with check (app.is_store_manager(store_id));

create policy products_update_manager on public.products
  for update to authenticated
  using (app.is_store_manager(store_id))
  with check (app.is_store_manager(store_id));

-- product_costs: owner/admin only (cashiers never see costs).
create policy product_costs_select_manager on public.product_costs
  for select to authenticated
  using (app.is_store_manager(store_id));

create policy product_costs_insert_manager on public.product_costs
  for insert to authenticated
  with check (app.is_store_manager(store_id));

create policy product_costs_update_manager on public.product_costs
  for update to authenticated
  using (app.is_store_manager(store_id))
  with check (app.is_store_manager(store_id));

-- Stock history: owner/admin read; written only by SQL functions.
create policy stock_entries_select_manager on public.stock_entries
  for select to authenticated
  using (app.is_store_manager(store_id));

create policy stock_entry_items_select_manager on public.stock_entry_items
  for select to authenticated
  using (app.is_store_manager(store_id));

create policy stock_movements_select_manager on public.stock_movements
  for select to authenticated
  using (app.is_store_manager(store_id));

-- customers: cashiers can look up and register customers; only owner/admin delete.
create policy customers_select_member on public.customers
  for select to authenticated
  using (app.is_store_member(store_id));

create policy customers_insert_member on public.customers
  for insert to authenticated
  with check (app.is_store_member(store_id));

create policy customers_update_member on public.customers
  for update to authenticated
  using (app.is_store_member(store_id))
  with check (app.is_store_member(store_id));

create policy customers_delete_manager on public.customers
  for delete to authenticated
  using (app.is_store_manager(store_id));

-- Sales and returns: every member reads all of the store's sales (decided in
-- phase 2: cashiers may reprint tickets). Writes only via create_sale /
-- create_return. Cost snapshots are owner/admin only.
create policy sales_select_member on public.sales
  for select to authenticated
  using (app.is_store_member(store_id));

create policy sale_items_select_member on public.sale_items
  for select to authenticated
  using (app.is_store_member(store_id));

create policy sale_item_costs_select_manager on public.sale_item_costs
  for select to authenticated
  using (app.is_store_manager(store_id));

create policy sale_payments_select_member on public.sale_payments
  for select to authenticated
  using (app.is_store_member(store_id));

create policy returns_select_member on public.returns
  for select to authenticated
  using (app.is_store_member(store_id));

create policy return_items_select_member on public.return_items
  for select to authenticated
  using (app.is_store_member(store_id));

-- activity_log: owner/admin read; nobody writes from the app (trigger only),
-- and a trigger blocks UPDATE/DELETE for everyone (functions migration).
create policy activity_log_select_manager on public.activity_log
  for select to authenticated
  using (store_id is not null and app.is_store_manager(store_id));

-- subscriptions: members can read their store's plan status (to gate access);
-- only the Stripe webhook (service_role) writes.
create policy subscriptions_select_member on public.subscriptions
  for select to authenticated
  using (app.is_store_member(store_id));

-- stripe_events: RLS enabled, no policies, no grants -> service_role only.
