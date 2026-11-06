-- Tenant isolation: a user of store A can never read, insert, update or
-- delete store B's data, through tables or through the RPC functions.
begin;
\ir _helpers.psql
select plan(40);

-- ---------------------------------------------------------------- fixtures
-- Store A (owner ua) and store B (owner ub), each with a product, stock,
-- a customer, a sale, a return, an invitation and a subscription.
select tests.create_user('a@iso.test', '10000000-0000-4000-8000-00000000000a');
select tests.create_user('b@iso.test', '10000000-0000-4000-8000-00000000000b');
select tests.create_store('10000000-0000-4000-8000-00000000000a', 'iso-a', '20000000-0000-4000-8000-00000000000a');
select tests.create_store('10000000-0000-4000-8000-00000000000b', 'iso-b', '20000000-0000-4000-8000-00000000000b');
select tests.create_product('20000000-0000-4000-8000-00000000000a', 'A-1', 10, '30000000-0000-4000-8000-00000000000a');
select tests.create_product('20000000-0000-4000-8000-00000000000b', 'B-1', 10, '30000000-0000-4000-8000-00000000000b');
select tests.create_product('20000000-0000-4000-8000-00000000000b', 'B-2', 5, '30000000-0000-4000-8000-0000000000bb'); -- no cost row
select tests.receive('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a', 10, 4);
select tests.receive('10000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b', 10, 4);
insert into public.customers (id, store_id, name) values
  ('40000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a', 'Customer A'),
  ('40000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-00000000000b', 'Customer B');
select tests.sell('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a', 2);
create temporary table b_sale as
  select tests.sell('10000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b', 2) as id;
grant select on b_sale to authenticated;
select tests.authenticate_as('10000000-0000-4000-8000-00000000000b');
select public.create_return((select id from b_sale),
  (select jsonb_build_array(jsonb_build_object('sale_item_id', si.id, 'quantity', 1))
   from public.sale_items si where si.sale_id = (select id from b_sale)));
select tests.reset_role();
insert into public.invitations (store_id, email, role, token_hash, expires_at) values
  ('20000000-0000-4000-8000-00000000000a', 'new-a@iso.test', 'cashier', 'hash-a', now() + interval '7 days'),
  ('20000000-0000-4000-8000-00000000000b', 'new-b@iso.test', 'cashier', 'hash-b', now() + interval '7 days');
insert into public.subscriptions (store_id, stripe_customer_id, status) values
  ('20000000-0000-4000-8000-00000000000a', 'cus_a', 'trialing'),
  ('20000000-0000-4000-8000-00000000000b', 'cus_b', 'trialing')
on conflict (store_id) do update set stripe_customer_id = excluded.stripe_customer_id, status = excluded.status;

-- ------------------------------------------------- READ: user A sees no B rows
select tests.authenticate_as('10000000-0000-4000-8000-00000000000a');

select is((select count(*)::int from public.stores where id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read store B');
select is((select count(*)::int from public.stores), 1, 'A sees exactly its own store');
select is((select count(*)::int from public.store_members where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B members');
select is((select count(*)::int from public.profiles where id = '10000000-0000-4000-8000-00000000000b'), 0, 'A cannot read the profile of B owner');
select is((select count(*)::int from public.invitations where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B invitations');
select is((select count(*)::int from public.products where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B products');
select is((select count(*)::int from public.products where store_id = '20000000-0000-4000-8000-00000000000a'), 1, 'A reads its own products');
select is((select count(*)::int from public.product_costs where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B product costs');
select is((select count(*)::int from public.stock_entries where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B stock entries');
select is((select count(*)::int from public.stock_entry_items where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B stock entry items');
select is((select count(*)::int from public.stock_movements where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B stock movements');
select is((select count(*)::int from public.customers where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B customers');
select is((select count(*)::int from public.sales where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B sales');
select is((select count(*)::int from public.sales where store_id = '20000000-0000-4000-8000-00000000000a'), 1, 'A reads its own sales');
select is((select count(*)::int from public.sale_items where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B sale items');
select is((select count(*)::int from public.sale_item_costs where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B sale item costs');
select is((select count(*)::int from public.sale_payments where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B payments');
select is((select count(*)::int from public.returns where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B returns');
select is((select count(*)::int from public.return_items where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B return items');
select is((select count(*)::int from public.activity_log where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B activity log');
select is((select count(*)::int from public.subscriptions where store_id = '20000000-0000-4000-8000-00000000000b'), 0, 'A cannot read B subscription');

-- ------------------------------------------- INSERT: rejected by WITH CHECK
select throws_ok(
  $$ insert into public.store_members (store_id, user_id, role)
     values ('20000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'owner') $$,
  '42501', null, 'A cannot add itself as owner of store B');
select throws_ok(
  $$ insert into public.products (store_id, sku, name, sale_price)
     values ('20000000-0000-4000-8000-00000000000b', 'X', 'Injected', 1) $$,
  '42501', null, 'A cannot insert products into B');
select throws_ok(
  $$ insert into public.customers (store_id, name) values ('20000000-0000-4000-8000-00000000000b', 'Injected') $$,
  '42501', null, 'A cannot insert customers into B');
select throws_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('20000000-0000-4000-8000-00000000000b', 'x@iso.test', 'admin', 'h', now() + interval '1 day') $$,
  '42501', null, 'A cannot create invitations for B');
select throws_ok(
  $$ insert into public.product_costs (product_id, store_id, cost_price)
     values ('30000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-00000000000b', 1) $$,
  '42501', null, 'A cannot write B product costs');

-- Composite foreign keys: A cannot point its own rows at B's records even
-- when it guesses their ids (RLS alone would only check the row's store_id).
select throws_ok(
  $$ insert into public.product_costs (product_id, store_id, cost_price)
     values ('30000000-0000-4000-8000-0000000000bb', '20000000-0000-4000-8000-00000000000a', 1) $$,
  '23503', null, 'composite FK blocks linking A cost to a B product');

-- ------------------------------- UPDATE / DELETE: B rows are invisible (0 rows)
update public.stores set name = 'Hacked' where id = '20000000-0000-4000-8000-00000000000b';
update public.products set sale_price = 0 where store_id = '20000000-0000-4000-8000-00000000000b';
update public.customers set name = 'Hacked' where store_id = '20000000-0000-4000-8000-00000000000b';
update public.store_members set role = 'cashier' where store_id = '20000000-0000-4000-8000-00000000000b';
delete from public.customers where store_id = '20000000-0000-4000-8000-00000000000b';
delete from public.store_members where store_id = '20000000-0000-4000-8000-00000000000b';
delete from public.invitations where store_id = '20000000-0000-4000-8000-00000000000b';

-- ------------------------------------------- RPC functions refuse store B
select throws_ok(
  $$ select public.create_sale('20000000-0000-4000-8000-00000000000b',
       '[{"product_id":"30000000-0000-4000-8000-00000000000b","quantity":1}]',
       '[{"method":"cash","amount":10}]', gen_random_uuid()) $$,
  '42501', 'forbidden', 'A cannot sell in store B');
select throws_ok(
  $$ select public.create_stock_entry('20000000-0000-4000-8000-00000000000b',
       '[{"product_id":"30000000-0000-4000-8000-00000000000b","quantity":5,"unit_cost":1}]') $$,
  '42501', 'forbidden', 'A cannot receive stock in store B');
select throws_ok(
  format($$ select public.create_return(%L,
       (select jsonb_build_array(jsonb_build_object('sale_item_id', gen_random_uuid(), 'quantity', 1)))) $$,
       (select id from b_sale)),
  'P0002', 'sale_not_found', 'A cannot return a B sale (and cannot even tell it exists)');
select throws_ok(
  $$ select public.create_sale('20000000-0000-4000-8000-00000000000a',
       '[{"product_id":"30000000-0000-4000-8000-00000000000b","quantity":1}]',
       '[{"method":"cash","amount":10}]', gen_random_uuid()) $$,
  'P0002', 'product_not_found', 'A cannot sell a B product in its own store');
select throws_ok(
  $$ select public.create_sale('20000000-0000-4000-8000-00000000000a',
       '[{"product_id":"30000000-0000-4000-8000-00000000000a","quantity":1}]',
       '[{"method":"cash","amount":10}]', gen_random_uuid(),
       '40000000-0000-4000-8000-00000000000b') $$,
  'P0002', 'customer_not_found', 'A cannot attach a B customer to its sale');

-- -------------------------------------- verify B is untouched (as postgres)
select tests.reset_role();
select is((select name from public.stores where id = '20000000-0000-4000-8000-00000000000b'), 'Iso B', 'store B name unchanged');
select is((select sale_price from public.products where id = '30000000-0000-4000-8000-00000000000b'), 10.00::numeric, 'B product price unchanged');
select is((select stock from public.products where id = '30000000-0000-4000-8000-00000000000b'), 9, 'B stock unchanged (10 - 2 sold + 1 returned)');
select is((select name from public.customers where id = '40000000-0000-4000-8000-00000000000b'), 'Customer B', 'B customer not renamed');
select is((select count(*)::int from public.customers where store_id = '20000000-0000-4000-8000-00000000000b'), 1, 'B customer not deleted');
select is((select role::text from public.store_members where store_id = '20000000-0000-4000-8000-00000000000b'), 'owner', 'B owner membership intact');
select is((select count(*)::int from public.invitations where store_id = '20000000-0000-4000-8000-00000000000b'), 1, 'B invitation not deleted');
select is((select count(*)::int from public.sales where store_id = '20000000-0000-4000-8000-00000000000b'), 1, 'no sale was created in B');

select * from finish();
rollback;
