-- Phase 5: import_products (atomic product import) and import_batches.
begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('owner@imp.test',   '19000000-0000-4000-8000-000000000001');
select tests.create_user('cashier@imp.test', '19000000-0000-4000-8000-000000000002');
select tests.create_user('other@imp.test',   '19000000-0000-4000-8000-000000000003');
select tests.create_store('19000000-0000-4000-8000-000000000001', 'imp-shop', '29000000-0000-4000-8000-000000000001');
select tests.add_member('29000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'cashier');
select tests.create_store('19000000-0000-4000-8000-000000000003', 'imp-other', '29000000-0000-4000-8000-000000000002');
-- An existing product (will be updated) with 10 units at cost 4.00.
select tests.create_product('29000000-0000-4000-8000-000000000001', 'EXIST-1', 10, '39000000-0000-4000-8000-000000000001');
select tests.receive('19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', 10, 4);

-- ------------------------------------------------------------- permissions
select ok(not has_function_privilege('anon', 'public.import_products(uuid, text, boolean, integer, integer, jsonb)', 'EXECUTE'),
  'anon cannot import');
select ok(not has_function_privilege('authenticated', 'app.receive_stock(uuid, jsonb, text, text, text, uuid)', 'EXECUTE'),
  'clients cannot call the internal receive_stock helper');

select tests.authenticate_as('19000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'x.csv', false, 1, 0,
       '[{"name":"Cashier item","sku":"C-1","sale_price":1}]') $$,
  '42501', 'forbidden', 'the cashier cannot import');
select tests.authenticate_as('19000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'x.csv', false, 1, 0,
       '[{"name":"Intruder","sku":"I-1","sale_price":1}]') $$,
  '42501', 'forbidden', 'another store''s owner cannot import into this store');

-- --------------------------------------------------- atomic failure cases
select tests.authenticate_as('19000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'bad.csv', false, 2, 0,
       '[{"name":"Good","sku":"NEW-OK","sale_price":5},{"name":"","sku":"NEW-BAD","sale_price":5}]') $$,
  '22023', 'invalid_row', 'an invalid row aborts the import');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'exists.csv', false, 2, 0,
       '[{"name":"Fresh","sku":"NEW-OK","sale_price":5},{"name":"Clash","sku":"EXIST-1","sale_price":5}]') $$,
  '23505', 'sku_exists', 'without "update existing", an existing SKU aborts the import');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'dup.csv', false, 2, 0,
       '[{"name":"A","sku":"DUP","sale_price":5},{"name":"B","sku":"DUP","sale_price":6}]') $$,
  '23505', 'duplicate_sku', 'duplicate SKUs in the payload are rejected');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'stock.csv', false, 1, 0,
       '[{"name":"No cost","sku":"NOCOST","sale_price":5,"initial_stock":3}]') $$,
  '22023', 'invalid_row', 'initial stock requires a unit cost');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'neg.csv', false, 1, 0,
       '[{"name":"Negative","sku":"NEG","sale_price":-1}]') $$,
  '22023', null, 'negative prices are rejected');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'big.csv', false, 2001, 0,
       (select jsonb_agg(jsonb_build_object('name', 'P' || g, 'sku', 'BIG-' || g, 'sale_price', 1)) from generate_series(1, 2001) g)) $$,
  '22023', 'invalid_row_count', 'more than 2,000 rows are rejected');
select throws_ok(
  $$ select public.import_products('29000000-0000-4000-8000-000000000001', 'count.csv', false, 5, 0,
       '[{"name":"A","sku":"CNT","sale_price":5}]') $$,
  '22023', 'invalid_row_count', 'row counts must add up (total = valid + skipped)');

select tests.reset_role();
select is((select count(*)::int from public.products where store_id = '29000000-0000-4000-8000-000000000001'), 1,
  'failed imports saved no products');
select is((select count(*)::int from public.import_batches), 0, 'failed imports left no import record');

-- ------------------------------------------------------- successful import
-- 2 new products (one with stock), 1 update of EXIST-1 (+10 units at 6.00), 1 row skipped by the app.
select tests.authenticate_as('19000000-0000-4000-8000-000000000001');
create temporary table batch as
  select public.import_products('29000000-0000-4000-8000-000000000001', 'catalog.xlsx', true, 4, 1,
    '[{"name":"Imported Cable","sku":"IMP-1","barcode":"7701234567890","category":"Cables","sale_price":12.5,"low_stock_threshold":3,"initial_stock":20,"unit_cost":5.25},
      {"name":"Imported Case","sku":"IMP-2","sale_price":9.99},
      {"name":"Existing renamed","sku":"EXIST-1","category":"Updated","sale_price":11,"low_stock_threshold":2,"initial_stock":10,"unit_cost":6}]'
  ) as id;
select tests.reset_role();

select is((select count(*)::int from public.products where store_id = '29000000-0000-4000-8000-000000000001' and deleted_at is null), 3,
  'two products created, one updated');
select is((select name || '|' || sale_price || '|' || low_stock_threshold from public.products where sku = 'EXIST-1'),
  'Existing renamed|11.00|2', 'the existing product was updated');
select is((select stock from public.products where sku = 'IMP-1'), 20, 'initial stock arrived through a stock entry');
select is((select stock from public.products where sku = 'IMP-2'), 0, 'rows without stock start at 0');
select is((select stock from public.products where sku = 'EXIST-1'), 20, 'imported stock is added to the current stock');
select is((select cost_price from public.product_costs c join public.products p on p.id = c.product_id where p.sku = 'EXIST-1'),
  5.00::numeric, 'weighted average cost: (10*4 + 10*6) / 20 = 5.00');
select is((select cost_price from public.product_costs c join public.products p on p.id = c.product_id where p.sku = 'IMP-1'),
  5.25::numeric, 'new product cost = its unit cost');
select is((select source || '|' || note from public.stock_entries where id = (select stock_entry_id from public.import_batches where id = (select id from batch))),
  'import|Import: catalog.xlsx', 'one stock entry marked as import');
select is((select created_count || '/' || updated_count || '/' || skipped_count || '/' || total_rows from public.import_batches where id = (select id from batch)),
  '2/1/1/4', 'import record keeps created/updated/skipped/total');
select is((select count(*)::int from public.activity_log where table_name = 'import_batches' and action = 'insert'
           and actor_id = '19000000-0000-4000-8000-000000000001'), 1, 'the import appears in the activity log');
select is((select count(*)::int from public.stock_entries where source = 'manual'
           and store_id = '29000000-0000-4000-8000-000000000001'), 1, 'create_stock_entry still records manual entries');

-- ------------------------------------------------- import history access
select tests.authenticate_as('19000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.import_batches), 0, 'the cashier cannot read the import history');
select tests.authenticate_as('19000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into public.import_batches (store_id, file_name, total_rows, created_count, updated_count, skipped_count)
     values ('29000000-0000-4000-8000-000000000001', 'fake.csv', 0, 0, 0, 0) $$,
  '42501', null, 'import records cannot be forged directly');

select * from finish();
rollback;
