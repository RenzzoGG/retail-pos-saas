-- Structural guarantees. These fail as soon as someone adds a table, column
-- grant or function that breaks the security model.
begin;
\ir _helpers.psql
select plan(11);

-- 1. Every table in public has RLS enabled. A new table without
--    `enable row level security` makes this test fail.
select is_empty(
  $$ select tablename::text from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'every table in public has RLS enabled'
);

-- 2. Tables with RLS but no policy deny everything to clients. Only tables that
--    are intentionally server-only may be in that state.
select set_eq(
  $$ select t.tablename::text from pg_tables t
     where t.schemaname = 'public'
       and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = t.tablename) $$,
  array['stripe_events'],
  'only stripe_events has no policies (service role only)'
);

-- 3. anon (not signed in) has no privileges at all on public tables or columns.
select is_empty(
  $$ select table_name::text || ':' || privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public' $$,
  'anon has no table privileges in public'
);
select is_empty(
  $$ select table_name::text || '.' || column_name from information_schema.column_privileges
     where grantee = 'anon' and table_schema = 'public' $$,
  'anon has no column privileges in public'
);

-- 4. authenticated has no access to Stripe event storage.
select is_empty(
  $$ select privilege_type::text from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public' and table_name = 'stripe_events' $$,
  'authenticated has no privileges on stripe_events'
);

-- 5. Stock and counters are never client-writable.
select ok(
  not has_column_privilege('authenticated', 'public.products', 'stock', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.products', 'stock', 'INSERT'),
  'authenticated cannot insert or update products.stock'
);
select ok(
  not has_column_privilege('authenticated', 'public.stores', 'last_sale_number', 'UPDATE'),
  'authenticated cannot update stores.last_sale_number'
);

-- 6. Writes on sales/returns/ledger/audit only happen through functions.
select is_empty(
  $$ select table_name::text || ':' || privilege_type from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
       and table_name in ('sales', 'sale_items', 'sale_item_costs', 'sale_payments', 'returns',
                          'return_items', 'stock_entries', 'stock_entry_items', 'stock_movements',
                          'activity_log', 'subscriptions') $$,
  'authenticated cannot write sales, returns, ledger, audit or subscription tables directly'
);

-- 7. Every SECURITY DEFINER function pins its search_path (prevents hijacking).
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app') and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'all SECURITY DEFINER functions set search_path'
);

-- 8. Signed-out users cannot call the RPC functions; signed-in users can.
select ok(
  not has_function_privilege('anon', 'public.create_sale(uuid, jsonb, jsonb, uuid, uuid, numeric, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_return(uuid, jsonb, text, public.payment_method)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_stock_entry(uuid, jsonb, text, text)', 'EXECUTE'),
  'anon cannot execute create_sale / create_return / create_stock_entry'
);

-- 9. Internal helpers in schema app are not callable by anon.
select ok(
  not has_function_privilege('anon', 'app.is_store_member(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app.log_activity()', 'EXECUTE'),
  'app helpers/triggers are not callable by clients'
);

select * from finish();
rollback;
