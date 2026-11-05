-- Phase 4: low-stock column, store time zone, soft delete rules.
begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('owner@inv4.test',   '18000000-0000-4000-8000-000000000001');
select tests.create_user('cashier@inv4.test', '18000000-0000-4000-8000-000000000002');
select tests.create_store('18000000-0000-4000-8000-000000000001', 'inv4-shop', '28000000-0000-4000-8000-000000000001');
select tests.add_member('28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'cashier');
select tests.create_product('28000000-0000-4000-8000-000000000001', 'LOW-1', 10, '38000000-0000-4000-8000-000000000001');
update public.products set low_stock_threshold = 3 where id = '38000000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------ is_low_stock
select is((select is_low_stock from public.products where id = '38000000-0000-4000-8000-000000000001'), true, 'out of stock counts as low stock');
select tests.receive('18000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', 5, 2);
select is((select is_low_stock from public.products where id = '38000000-0000-4000-8000-000000000001'), false, 'above the threshold after receiving stock');
select tests.sell('18000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', 2);
select is((select is_low_stock from public.products where id = '38000000-0000-4000-8000-000000000001'), true, 'stock = threshold (3) is low stock after a sale');
select is((select count(*)::int from public.activity_log where table_name = 'products' and action = 'update'
           and record_id = '38000000-0000-4000-8000-000000000001'), 1,
  'stock/low-stock changes from sales are not logged as product edits (only the threshold edit is)');

select tests.authenticate_as('18000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.products set is_low_stock = false where id = '38000000-0000-4000-8000-000000000001' $$,
  '428C9', null, 'is_low_stock is not client-writable (generated column)');
select tests.reset_role();
select throws_ok(
  $$ update public.products set is_low_stock = false where id = '38000000-0000-4000-8000-000000000001' $$,
  '428C9', null, 'is_low_stock is generated (not even postgres can set it)');

-- --------------------------------------------------------------- time zone
select is((select timezone from public.stores where id = '28000000-0000-4000-8000-000000000001'), 'UTC', 'stores default to UTC');
select tests.authenticate_as('18000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ update public.stores set timezone = 'America/Lima' where id = '28000000-0000-4000-8000-000000000001' $$,
  'the owner can set the store time zone');
select throws_ok(
  $$ update public.stores set timezone = 'Mars/Olympus' where id = '28000000-0000-4000-8000-000000000001' $$,
  '22023', 'invalid_timezone', 'unknown time zones are rejected');
create temporary table zoned as select public.create_store('Zoned shop', 'EUR', 0.21, false, 'Europe/Madrid') as id;
select is((select timezone from public.stores where id = (select id from zoned)), 'Europe/Madrid', 'create_store accepts a time zone');
select throws_ok(
  $$ select public.create_store('Bad zone', 'USD', 0, true, 'Nowhere/Land') $$,
  '22023', 'invalid_timezone', 'create_store rejects unknown time zones');

select tests.authenticate_as('18000000-0000-4000-8000-000000000002');
update public.stores set timezone = 'Asia/Tokyo' where id = '28000000-0000-4000-8000-000000000001';
select tests.reset_role();
select is((select timezone from public.stores where id = '28000000-0000-4000-8000-000000000001'), 'America/Lima', 'cashiers cannot change the time zone');

-- ------------------------------------------------------------- soft delete
select tests.authenticate_as('18000000-0000-4000-8000-000000000002');
update public.products set deleted_at = now() where id = '38000000-0000-4000-8000-000000000001';
select tests.reset_role();
select is((select deleted_at from public.products where id = '38000000-0000-4000-8000-000000000001'), null, 'cashiers cannot delete products');

select tests.authenticate_as('18000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ update public.products set deleted_at = now() where id = '38000000-0000-4000-8000-000000000001' $$,
  'the owner can soft-delete a product');
select lives_ok(
  $$ insert into public.products (store_id, sku, name, sale_price) values ('28000000-0000-4000-8000-000000000001', 'LOW-1', 'Reused SKU', 5) $$,
  'a deleted product frees its SKU for reuse');
select throws_ok(
  $$ insert into public.products (store_id, sku, name, sale_price) values ('28000000-0000-4000-8000-000000000001', 'LOW-1', 'Duplicate', 5) $$,
  '23505', null, 'SKUs stay unique among active products');
select tests.reset_role();
select is((select stock from public.products where id = '38000000-0000-4000-8000-000000000001'), 3, 'soft delete keeps the stock history intact');

select * from finish();
rollback;
