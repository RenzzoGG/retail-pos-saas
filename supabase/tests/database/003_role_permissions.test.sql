-- Role permissions inside ONE store: owner, admin and cashier.
-- Cashier: sells and registers customers, but never sees costs/profit, never
-- changes prices or store settings, never does returns or stock entries.
begin;
\ir _helpers.psql
select plan(38);

-- ---------------------------------------------------------------- fixtures
select tests.create_user('owner@roles.test',   '11000000-0000-4000-8000-000000000001');
select tests.create_user('admin@roles.test',   '11000000-0000-4000-8000-000000000002');
select tests.create_user('cashier@roles.test', '11000000-0000-4000-8000-000000000003');
select tests.create_user('newbie@roles.test',  '11000000-0000-4000-8000-000000000004');
select tests.create_store('11000000-0000-4000-8000-000000000001', 'roles-shop', '21000000-0000-4000-8000-000000000001');
select tests.add_member('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'admin');
select tests.add_member('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'cashier');
select tests.create_product('21000000-0000-4000-8000-000000000001', 'R-1', 20, '31000000-0000-4000-8000-000000000001');
select tests.receive('11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 10, 8);
create temporary table s as
  select tests.sell('11000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 2) as id;
grant select on s to authenticated;
insert into public.customers (id, store_id, name) values
  ('41000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Regular');
insert into public.invitations (store_id, email, role, token_hash, expires_at) values
  ('21000000-0000-4000-8000-000000000001', 'x@roles.test', 'cashier', 'hash-r', now() + interval '1 day');

-- =================================================================== CASHIER
select tests.authenticate_as('11000000-0000-4000-8000-000000000003');

-- Can do their job.
select is((select count(*)::int from public.products), 1, 'cashier reads products (name, price, stock)');
select is((select count(*)::int from public.sales), 1, 'cashier reads the store sales (e.g. reprint a ticket)');
select is((select count(*)::int from public.sale_items), 1, 'cashier reads sale lines');
select lives_ok(
  $$ insert into public.customers (store_id, name) values ('21000000-0000-4000-8000-000000000001', 'Walk-in') $$,
  'cashier can register a customer');
select lives_ok(
  $$ select public.create_sale('21000000-0000-4000-8000-000000000001',
       '[{"product_id":"31000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"card","amount":20}]', gen_random_uuid()) $$,
  'cashier can sell');

-- Never sees costs / profit / internal history.
select is((select count(*)::int from public.product_costs), 0, 'cashier cannot read product costs');
select is((select count(*)::int from public.sale_item_costs), 0, 'cashier cannot read sale costs (profit)');
select is((select count(*)::int from public.stock_entries), 0, 'cashier cannot read stock entries (they include unit costs)');
select is((select count(*)::int from public.stock_entry_items), 0, 'cashier cannot read stock entry items');
select is((select count(*)::int from public.stock_movements), 0, 'cashier cannot read stock movements');
select is((select count(*)::int from public.activity_log), 0, 'cashier cannot read the activity log');
select is((select count(*)::int from public.invitations), 0, 'cashier cannot read invitations');

-- Cannot change prices, products or store settings (0 rows / rejected).
update public.products set sale_price = 1 where id = '31000000-0000-4000-8000-000000000001';
update public.stores set tax_rate = 0, prices_include_tax = false where id = '21000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ insert into public.products (store_id, sku, name, sale_price) values ('21000000-0000-4000-8000-000000000001', 'C-1', 'By cashier', 1) $$,
  '42501', null, 'cashier cannot create products');
select throws_ok(
  $$ insert into public.product_costs (product_id, store_id, cost_price) values ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 0) $$,
  '42501', null, 'cashier cannot write costs');

-- Cannot do returns or stock entries.
select throws_ok(
  format($$ select public.create_return(%L, (select jsonb_build_array(jsonb_build_object('sale_item_id', si.id, 'quantity', 1))
                                              from public.sale_items si where si.sale_id = %L)) $$,
         (select id from s), (select id from s)),
  '42501', 'forbidden', 'cashier cannot make returns');
select throws_ok(
  $$ select public.create_stock_entry('21000000-0000-4000-8000-000000000001',
       '[{"product_id":"31000000-0000-4000-8000-000000000001","quantity":1,"unit_cost":1}]') $$,
  '42501', 'forbidden', 'cashier cannot receive stock');

-- Cannot manage the team or promote themselves.
select throws_ok(
  $$ insert into public.store_members (store_id, user_id, role)
     values ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'cashier') $$,
  '42501', null, 'cashier cannot add members');
update public.store_members set role = 'owner' where user_id = '11000000-0000-4000-8000-000000000003';
delete from public.customers where id = '41000000-0000-4000-8000-000000000001';
select throws_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('21000000-0000-4000-8000-000000000001', 'y@roles.test', 'cashier', 'h2', now() + interval '1 day') $$,
  '42501', null, 'cashier cannot invite');

select tests.reset_role();
select is((select sale_price from public.products where id = '31000000-0000-4000-8000-000000000001'), 20.00::numeric, 'price unchanged after cashier update');
select is((select tax_rate from public.stores where id = '21000000-0000-4000-8000-000000000001'), 0.0825::numeric, 'store tax settings unchanged after cashier update');
select is((select role::text from public.store_members where user_id = '11000000-0000-4000-8000-000000000003'), 'cashier', 'cashier could not promote itself');
select is((select count(*)::int from public.customers where id = '41000000-0000-4000-8000-000000000001'), 1, 'cashier cannot delete customers');

-- ===================================================================== ADMIN
select tests.authenticate_as('11000000-0000-4000-8000-000000000002');

select is((select count(*)::int from public.product_costs), 1, 'admin reads product costs');
select is((select count(*)::int from public.sale_item_costs), 2, 'admin reads sale costs');
select lives_ok(
  $$ update public.products set sale_price = 25 where id = '31000000-0000-4000-8000-000000000001' $$,
  'admin can change prices');
select lives_ok(
  $$ update public.stores set ticket_footer = 'See you soon' where id = '21000000-0000-4000-8000-000000000001' $$,
  'admin can configure the store');
select lives_ok(
  $$ insert into public.store_members (store_id, user_id, role)
     values ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'cashier') $$,
  'admin can add a cashier');
select throws_ok(
  $$ update public.store_members set role = 'owner' where user_id = '11000000-0000-4000-8000-000000000004' $$,
  '42501', null, 'admin cannot promote anyone to owner');
select throws_ok(
  $$ update public.store_members set role = 'owner' where user_id = '11000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'admin cannot promote itself to owner');
delete from public.store_members where user_id = '11000000-0000-4000-8000-000000000001';
select lives_ok(
  format($$ select public.create_return(%L, (select jsonb_build_array(jsonb_build_object('sale_item_id', si.id, 'quantity', 1))
                                              from public.sale_items si where si.sale_id = %L)) $$,
         (select id from s), (select id from s)),
  'admin can make returns');

select tests.reset_role();
select is((select sale_price from public.products where id = '31000000-0000-4000-8000-000000000001'), 25.00::numeric, 'admin price change applied');
select is((select count(*)::int from public.store_members where user_id = '11000000-0000-4000-8000-000000000001'), 1, 'admin cannot remove the owner');

-- ===================================================================== OWNER
select tests.authenticate_as('11000000-0000-4000-8000-000000000001');

select lives_ok(
  $$ update public.store_members set role = 'admin' where user_id = '11000000-0000-4000-8000-000000000003' $$,
  'owner can promote a cashier to admin');
select throws_ok(
  $$ delete from public.store_members where user_id = '11000000-0000-4000-8000-000000000001' $$,
  '23514', 'store_needs_owner', 'the last owner cannot leave the store');

-- Column-level privileges hold even for the owner.
select throws_ok(
  $$ update public.stores set last_sale_number = 0 where id = '21000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nobody can reset the sale counter');
select throws_ok(
  $$ update public.products set store_id = '21000000-0000-4000-8000-000000000009' where id = '31000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'rows cannot be moved to another store');
select throws_ok(
  $$ insert into public.customers (store_id, name, created_by)
     values ('21000000-0000-4000-8000-000000000001', 'Spoof', '11000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'created_by cannot be spoofed');

insert into public.customers (store_id, name)
  values ('21000000-0000-4000-8000-000000000001', 'By owner');
select is((select created_by from public.customers where name = 'By owner'),
  '11000000-0000-4000-8000-000000000001'::uuid, 'created_by is filled from the session');

select * from finish();
rollback;
