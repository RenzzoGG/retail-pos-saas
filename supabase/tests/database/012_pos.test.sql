-- Phase 6: cashier discount limit, split payments, stock error details.
begin;
\ir _helpers.psql
select plan(14);

select tests.create_user('owner@pos.test',   '1a000000-0000-4000-8000-000000000001');
select tests.create_user('cashier@pos.test', '1a000000-0000-4000-8000-000000000002');
select tests.create_store('1a000000-0000-4000-8000-000000000001', 'pos-shop', '2a000000-0000-4000-8000-000000000001');
select tests.add_member('2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002', 'cashier');
select tests.create_product('2a000000-0000-4000-8000-000000000001', 'POS-1', 50.00, '3a000000-0000-4000-8000-000000000001');
select tests.create_product('2a000000-0000-4000-8000-000000000001', 'POS-2', 50.00, '3a000000-0000-4000-8000-000000000002');
select tests.receive('1a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000001', 20, 20);

select is((select max_cashier_discount_pct from public.stores where id = '2a000000-0000-4000-8000-000000000001'), 10.00::numeric,
  'cashier discount limit defaults to 10 %');

-- --------------------------------------------------------- cashier limit
-- Gross 2 x 50.00 = 100.00. Exactly 10.00 of discount (10 %) is allowed.
select tests.authenticate_as('1a000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.create_sale('2a000000-0000-4000-8000-000000000001',
       '[{"product_id":"3a000000-0000-4000-8000-000000000001","quantity":2,"discount":4.00}]',
       '[{"method":"card","amount":90.00}]', gen_random_uuid(), null, 6.00) $$,
  'a cashier can give exactly the limit (4.00 line + 6.00 sale = 10 %)');
select throws_ok(
  $$ select public.create_sale('2a000000-0000-4000-8000-000000000001',
       '[{"product_id":"3a000000-0000-4000-8000-000000000001","quantity":2}]',
       '[{"method":"card","amount":89.99}]', gen_random_uuid(), null, 10.01) $$,
  '42501', 'discount_limit_exceeded', 'a cashier cannot go over the limit (10.01 %)');
select throws_ok(
  $$ select public.create_sale('2a000000-0000-4000-8000-000000000001',
       '[{"product_id":"3a000000-0000-4000-8000-000000000001","quantity":1,"discount":5.01}]',
       '[{"method":"card","amount":44.99}]', gen_random_uuid()) $$,
  '42501', 'discount_limit_exceeded', 'line discounts count towards the limit too');
-- RLS hides the store row from a cashier's UPDATE (0 rows); checked as owner below.
update public.stores set max_cashier_discount_pct = 90 where id = '2a000000-0000-4000-8000-000000000001';

-- Owners have no limit and can change it (0–100).
select tests.authenticate_as('1a000000-0000-4000-8000-000000000001');
select is((select max_cashier_discount_pct from public.stores where id = '2a000000-0000-4000-8000-000000000001'), 10.00::numeric,
  'cashiers cannot raise their own limit');
select lives_ok(
  $$ select public.create_sale('2a000000-0000-4000-8000-000000000001',
       '[{"product_id":"3a000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"cash","amount":10.00}]', gen_random_uuid(), null, 40.00) $$,
  'owners can give any discount (80 %)');
select lives_ok(
  $$ update public.stores set max_cashier_discount_pct = 25 where id = '2a000000-0000-4000-8000-000000000001' $$,
  'the owner can change the cashier limit');
select throws_ok(
  $$ update public.stores set max_cashier_discount_pct = 101 where id = '2a000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the limit must be between 0 and 100');

select tests.authenticate_as('1a000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.create_sale('2a000000-0000-4000-8000-000000000001',
       '[{"product_id":"3a000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"card","amount":38.00}]', gen_random_uuid(), null, 12.00) $$,
  'with a 25 % limit the cashier can give 24 %');

-- ---------------------------------------------------- split payment, change
create temporary table split (id uuid);
grant all on split to authenticated;
insert into split select public.create_sale('2a000000-0000-4000-8000-000000000001',
  '[{"product_id":"3a000000-0000-4000-8000-000000000001","quantity":2}]',
  '[{"method":"card","amount":60.00},{"method":"transfer","amount":10.00},{"method":"cash","amount":30.00,"tendered":50.00}]',
  gen_random_uuid());
select tests.reset_role();
select is((select count(*)::int from public.sale_payments where sale_id = (select id from split)), 3, 'three payment methods in one sale');
select is((select tendered - amount from public.sale_payments where sale_id = (select id from split) and method = 'cash'), 20.00::numeric,
  'cash change = tendered - amount (20.00)');
select is((select total from public.sales where id = (select id from split)), 100.00::numeric, 'total covered by the split payment');

-- --------------------------------------------- insufficient stock details
select tests.authenticate_as('1a000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.create_sale('2a000000-0000-4000-8000-000000000001',
       '[{"product_id":"3a000000-0000-4000-8000-000000000002","quantity":1}]',
       '[{"method":"card","amount":50.00}]', gen_random_uuid()) $$,
  '23514', 'insufficient_stock', 'a product without stock cannot be sold');
select tests.reset_role();
select is((select stock from public.products where id = '3a000000-0000-4000-8000-000000000001'), 14,
  'stock = 20 - 2 - 1 - 1 - 2 (failed sales changed nothing)');

select * from finish();
rollback;
