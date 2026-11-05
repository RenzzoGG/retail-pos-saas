-- Stock can only change through create_sale / create_return /
-- create_stock_entry, never directly, and can never be negative.
begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('owner@stock.test', '12000000-0000-4000-8000-000000000001');
select tests.create_store('12000000-0000-4000-8000-000000000001', 'stock-shop', '22000000-0000-4000-8000-000000000001');
select tests.create_product('22000000-0000-4000-8000-000000000001', 'S-1', 10, '32000000-0000-4000-8000-000000000001');
select tests.create_product('22000000-0000-4000-8000-000000000001', 'S-2', 10, '32000000-0000-4000-8000-000000000002');
select tests.receive('12000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 5, 4);

-- ------------------------------------------- direct changes are rejected
select tests.authenticate_as('12000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.products set stock = 999 where id = '32000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'owner cannot update stock directly (no column privilege)');
select throws_ok(
  $$ insert into public.products (store_id, sku, name, sale_price, stock)
     values ('22000000-0000-4000-8000-000000000001', 'S-9', 'Preloaded', 1, 50) $$,
  '42501', null, 'owner cannot create a product with initial stock');

-- Even the server key (service_role, bypasses RLS) and postgres are stopped by the trigger.
select tests.act_as_service_role();
select throws_ok(
  $$ update public.products set stock = 999 where id = '32000000-0000-4000-8000-000000000001' $$,
  '42501', 'stock_is_read_only', 'service_role cannot update stock directly');
select tests.reset_role();
select throws_ok(
  $$ update public.products set stock = 999 where id = '32000000-0000-4000-8000-000000000001' $$,
  '42501', 'stock_is_read_only', 'postgres cannot update stock directly either');
select throws_ok(
  $$ insert into public.products (store_id, sku, name, sale_price, stock)
     values ('22000000-0000-4000-8000-000000000001', 'S-8', 'Preloaded', 1, 50) $$,
  '42501', 'stock_is_read_only', 'postgres cannot insert a product with stock either');

-- Last line of defense: even bypassing the guard, CHECK (stock >= 0) holds.
select set_config('app.stock_write', 'on', true);
select throws_ok(
  $$ update public.products set stock = -1 where id = '32000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'CHECK constraint forbids negative stock');
select set_config('app.stock_write', 'off', true);

-- --------------------------------------- sales cannot oversell (atomic check)
select tests.authenticate_as('12000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.create_sale('22000000-0000-4000-8000-000000000001',
       '[{"product_id":"32000000-0000-4000-8000-000000000001","quantity":6}]',
       '[{"method":"cash","amount":60}]', gen_random_uuid()) $$,
  '23514', 'insufficient_stock', 'cannot sell more than the stock');
-- A multi-line sale where only the 2nd line fails leaves nothing behind.
select throws_ok(
  $$ select public.create_sale('22000000-0000-4000-8000-000000000001',
       '[{"product_id":"32000000-0000-4000-8000-000000000001","quantity":1},
         {"product_id":"32000000-0000-4000-8000-000000000002","quantity":1}]',
       '[{"method":"cash","amount":20}]', gen_random_uuid()) $$,
  '23514', 'insufficient_stock', 'one line without stock fails the whole sale');
select throws_ok(
  $$ select public.create_sale('22000000-0000-4000-8000-000000000001',
       '[{"product_id":"32000000-0000-4000-8000-000000000001","quantity":1.5}]',
       '[{"method":"cash","amount":15}]', gen_random_uuid()) $$,
  '22023', 'invalid_quantity', 'fractional quantities are rejected (whole units only)');
select throws_ok(
  $$ select public.create_sale('22000000-0000-4000-8000-000000000001',
       '[{"product_id":"32000000-0000-4000-8000-000000000001","quantity":-2}]',
       '[{"method":"cash","amount":20}]', gen_random_uuid()) $$,
  '22023', 'invalid_quantity', 'negative quantities are rejected');
select throws_ok(
  $$ select public.create_stock_entry('22000000-0000-4000-8000-000000000001',
       '[{"product_id":"32000000-0000-4000-8000-000000000001","quantity":0,"unit_cost":1}]') $$,
  '22023', 'invalid_quantity', 'stock entries need a positive quantity');

select tests.reset_role();
select is((select stock from public.products where id = '32000000-0000-4000-8000-000000000001'), 5, 'stock unchanged after all rejected operations');
select is((select count(*)::int from public.sales where store_id = '22000000-0000-4000-8000-000000000001'), 0, 'no partial sale was stored');
select is((select last_sale_number from public.stores where id = '22000000-0000-4000-8000-000000000001'), 0, 'sale counter not consumed by failed sales');

-- Soft-deleted / inactive products cannot be sold.
update public.products set active = false where id = '32000000-0000-4000-8000-000000000001';
select tests.authenticate_as('12000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.create_sale('22000000-0000-4000-8000-000000000001',
       '[{"product_id":"32000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"cash","amount":10}]', gen_random_uuid()) $$,
  'P0002', 'product_not_found', 'inactive products cannot be sold');
select tests.reset_role();
update public.products set active = true where id = '32000000-0000-4000-8000-000000000001';

-- ------------------------- the ledger always explains the stock (Σ movements)
select tests.sell('12000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 3);
select tests.receive('12000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', 4, 2);
select tests.sell('12000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', 4);
select is((select stock from public.products where id = '32000000-0000-4000-8000-000000000002'), 0, 'selling the last unit leaves exactly 0');
select is_empty(
  $$ select p.id from public.products p
     where p.store_id = '22000000-0000-4000-8000-000000000001'
       and p.stock <> coalesce((select sum(m.quantity) from public.stock_movements m where m.product_id = p.id), 0) $$,
  'stock = sum of stock_movements for every product');
select is_empty(
  $$ select m.id from public.stock_movements m
     where m.store_id = '22000000-0000-4000-8000-000000000001'
       and m.stock_after <> (select sum(m2.quantity) from public.stock_movements m2
                             where m2.product_id = m.product_id and m2.id <= m.id) $$,
  'every movement records the running stock correctly');
select is(coalesce(current_setting('app.stock_write', true), ''), 'off', 'the stock-write flag is turned off after each function');

select * from finish();
rollback;
