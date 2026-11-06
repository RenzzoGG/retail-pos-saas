-- Phase 8: report functions. Known amounts, dates around the DST change in
-- America/New_York (2026-03-08 02:00 -> 03:00), a restocked return and a write-off.
begin;
\ir _helpers.psql
select plan(27);

-- Store: tax 10 % added on top, New York time.
select tests.create_user('owner@rep.test',   '1c000000-0000-4000-8000-000000000001');
select tests.create_user('cashier@rep.test', '1c000000-0000-4000-8000-000000000002');
select tests.create_user('other@rep.test',   '1c000000-0000-4000-8000-000000000003');
select tests.create_store('1c000000-0000-4000-8000-000000000001', 'rep-shop', '2c000000-0000-4000-8000-000000000001', 0.10, false);
select tests.create_store('1c000000-0000-4000-8000-000000000003', 'rep-other', '2c000000-0000-4000-8000-000000000002');
select tests.add_member('2c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000002', 'cashier');
update public.stores set timezone = 'America/New_York' where id = '2c000000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Rita Owner' where id = '1c000000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Carl Cashier' where id = '1c000000-0000-4000-8000-000000000002';

-- A: 10.00, cost 4 (Cables). B: 50.00, cost 30 (no category).
select tests.create_product('2c000000-0000-4000-8000-000000000001', 'REP-A', 10, '3c000000-0000-4000-8000-000000000001');
select tests.create_product('2c000000-0000-4000-8000-000000000001', 'REP-B', 50, '3c000000-0000-4000-8000-000000000002');
update public.products set category = 'Cables' where id = '3c000000-0000-4000-8000-000000000001';
select tests.receive('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 10, 4);
select tests.receive('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000002', 5, 30);

-- S1: 2 x A by the cashier = 20 + 2 tax = 22, on Sat 2026-03-07 15:00 EST.
-- S2: 1 x B by the owner   = 50 + 5 tax = 55, on Sun 2026-03-08 23:30 EDT (UTC date: 03-09).
-- S3: 1 x A by the cashier = 10 + 1 tax = 11, on Tue 2026-03-10 10:00 EDT.
create temporary table s (k text, id uuid);
grant all on s to authenticated;
insert into s values
  ('s1', tests.sell('1c000000-0000-4000-8000-000000000002', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 2)),
  ('s2', tests.sell('1c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000002', 1)),
  ('s3', tests.sell('1c000000-0000-4000-8000-000000000002', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 1));

-- Returns on 2026-03-10: R1 = S2's B, damaged (write-off), refunded 55 in cash;
-- R2 = one A of S1, back to stock, refunded 11 by card.
create temporary table r (k text, id uuid);
grant all on r to authenticated;
select tests.authenticate_as('1c000000-0000-4000-8000-000000000001');
insert into r values
  ('r1', public.create_return((select id from s where k = 's2'),
     jsonb_build_array(jsonb_build_object('sale_item_id', (select si.id from public.sale_items si where si.sale_id = (select id from s where k = 's2')), 'quantity', 1, 'restock', false)),
     'Broken', 'cash')),
  ('r2', public.create_return((select id from s where k = 's1'),
     jsonb_build_array(jsonb_build_object('sale_item_id', (select si.id from public.sale_items si where si.sale_id = (select id from s where k = 's1')), 'quantity', 1)),
     null, 'card'));
select tests.reset_role();

-- Backdate (test runner = postgres).
update public.sales x set created_at = v.at from (values
  ('s1', timestamptz '2026-03-07 15:00 America/New_York'),
  ('s2', timestamptz '2026-03-08 23:30 America/New_York'),
  ('s3', timestamptz '2026-03-10 10:00 America/New_York')) v(k, at)
  join s on s.k = v.k where x.id = s.id;
update public.sale_payments p set created_at = x.created_at from public.sales x where p.sale_id = x.id and x.store_id = '2c000000-0000-4000-8000-000000000001';
update public.returns x set created_at = v.at from (values
  ('r1', timestamptz '2026-03-10 12:00 America/New_York'),
  ('r2', timestamptz '2026-03-10 13:00 America/New_York')) v(k, at)
  join r on r.k = v.k where x.id = r.id;

-- S4: today (not backdated), by the cashier: only for dashboard_today.
select tests.sell('1c000000-0000-4000-8000-000000000002', '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001', 3);

-- Range: 2026-03-07 .. 2026-03-10 in New York = [03-07 05:00Z, 03-11 04:00Z).
create temporary table rng as
  select timestamptz '2026-03-07 00:00 America/New_York' as f, timestamptz '2026-03-11 00:00 America/New_York' as t;
grant select on rng to authenticated;

-- =============================================================== owner: values
select tests.authenticate_as('1c000000-0000-4000-8000-000000000001');

-- Profit = (88 - 8 tax) - 42 cost - (66 refunds - 6 tax) + 4 restocked = -18
-- (= per sale: S1 6, S2 -30, S3 6).
select results_eq(
  $$ select * from public.report_summary('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  $$ values (3, 4, 88.00::numeric, 0.00::numeric, 2.00::numeric, 29.33::numeric, 2, 2, 66.00::numeric,
             22.00::numeric, 42.00::numeric, 4.00::numeric, 1, 30.00::numeric, -18.00::numeric) $$,
  'summary: sales, tax net of refunds, returns, write-off and profit');

select results_eq(
  $$ select * from public.report_timeseries('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng), 'day') $$,
  $$ values (date '2026-03-07', 1, 22.00::numeric, 0.00::numeric, 22.00::numeric, 12.00::numeric),
            (date '2026-03-08', 1, 55.00::numeric, 0.00::numeric, 55.00::numeric, 20.00::numeric),
            (date '2026-03-09', 0, 0::numeric, 0::numeric, 0::numeric, 0.00::numeric),
            (date '2026-03-10', 1, 11.00::numeric, 66.00::numeric, -55.00::numeric, -50.00::numeric) $$,
  'daily series in store time (23:30 EDT stays on 03-08), empty days included, returns on their date');

select results_eq(
  $$ select * from public.report_timeseries('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng), 'month') $$,
  $$ values (date '2026-03-01', 3, 88.00::numeric, 66.00::numeric, 22.00::numeric, -18.00::numeric) $$,
  'monthly series adds up to the summary');

select results_eq(
  $$ select sku, units_sold, units_returned, net_units, net_sales
     from public.report_products('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng), 'units', 10) $$,
  $$ values ('REP-A', 3, 1, 2, 22.00::numeric), ('REP-B', 1, 1, 0, 0.00::numeric) $$,
  'products: units and revenue net of returns');

select results_eq(
  $$ select * from public.report_categories('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  $$ values ('Cables', 2, 22.00::numeric), ('Uncategorized', 0, 0.00::numeric) $$,
  'categories (no category = Uncategorized)');

select results_eq(
  $$ select method::text, payments_count, collected, refunds, net
     from public.report_payment_methods('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  $$ values ('cash', 3, 88.00::numeric, 55.00::numeric, 33.00::numeric),
            ('transfer', 0, 0::numeric, 0::numeric, 0::numeric),
            ('card', 0, 0::numeric, 11.00::numeric, -11.00::numeric) $$,
  'payment methods: collected minus refunds per method (net adds up to net sales)');

select results_eq(
  $$ select cashier_name, sales_count, gross_sales, avg_ticket
     from public.report_cashiers('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  $$ values ('Rita Owner', 1, 55.00::numeric, 55.00::numeric), ('Carl Cashier', 2, 33.00::numeric, 16.50::numeric) $$,
  'sales per cashier');

select results_eq(
  $$ select status::text, units, items_subtotal, tax, total, refunded, net, payment_methods, cost, profit
     from public.report_sales_export('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  $$ values ('partially_returned', 2, 20.00::numeric, 2.00::numeric, 22.00::numeric, 11.00::numeric, 11.00::numeric, 'Cash', 8.00::numeric, 6.00::numeric),
            ('returned', 1, 50.00::numeric, 5.00::numeric, 55.00::numeric, 55.00::numeric, 0.00::numeric, 'Cash', 30.00::numeric, -30.00::numeric),
            ('completed', 1, 10.00::numeric, 1.00::numeric, 11.00::numeric, 0::numeric, 11.00::numeric, 'Cash', 4.00::numeric, 6.00::numeric) $$,
  'export: one row per sale with refunds to date and profit after returns');

select results_eq(
  $$ select sku, quantity, line_total, returned_qty, written_off_qty, unit_cost
     from public.report_sale_lines_export('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  $$ values ('REP-A', 2, 20.00::numeric, 1, 0, 4.00::numeric),
            ('REP-B', 1, 50.00::numeric, 1, 1, 30.00::numeric),
            ('REP-A', 1, 10.00::numeric, 0, 0, 4.00::numeric) $$,
  'export lines with returned and written-off units');

select throws_ok(
  $$ select * from public.report_summary('2c000000-0000-4000-8000-000000000001', (select t from rng), (select f from rng)) $$,
  '22023', 'invalid_range', 'an inverted range is rejected');

select results_eq(
  $$ select store_sales_count, store_sales_total, my_sales_count, my_sales_total from public.dashboard_today('2c000000-0000-4000-8000-000000000001') $$,
  $$ values (1, 33.00::numeric, 0, 0::numeric) $$,
  'dashboard_today for the owner: the store sold today, the owner did not');

-- ============================================== cashier: never costs or profit
select tests.authenticate_as('1c000000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.report_summary('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_summary forbidden');
select throws_ok($$ select * from public.report_timeseries('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_timeseries forbidden');
select throws_ok($$ select * from public.report_products('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_products forbidden');
select throws_ok($$ select * from public.report_categories('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_categories forbidden');
select throws_ok($$ select * from public.report_payment_methods('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_payment_methods forbidden');
select throws_ok($$ select * from public.report_cashiers('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_cashiers forbidden');
select throws_ok($$ select * from public.report_sales_export('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_sales_export forbidden');
select throws_ok($$ select * from public.report_sale_lines_export('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'cashier: report_sale_lines_export forbidden');
-- Second layer: even the internal building block shows no cost to a cashier (RLS).
select is((select coalesce(sum(cost), 0) from app.sale_facts('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng))),
  0::numeric, 'RLS hides sale costs from cashiers even inside the building blocks');
select results_eq(
  $$ select store_sales_count, store_sales_total, my_sales_count, my_sales_total from public.dashboard_today('2c000000-0000-4000-8000-000000000001') $$,
  $$ values (1, 33.00::numeric, 1, 33.00::numeric) $$,
  'dashboard_today for the cashier: store and own sales of today');
select ok(not exists (
    select 1 from pg_proc p, unnest(p.proargnames) a
    where p.proname = 'dashboard_today' and (a ilike '%cost%' or a ilike '%profit%' or a ilike '%margin%')),
  'dashboard_today has no cost or profit column');

-- ============================================== another store, anon
select tests.authenticate_as('1c000000-0000-4000-8000-000000000003');
select throws_ok($$ select * from public.report_summary('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng)) $$,
  '42501', 'forbidden', 'the owner of another store cannot read this store reports');
select throws_ok($$ select * from public.dashboard_today('2c000000-0000-4000-8000-000000000001') $$,
  '42501', 'forbidden', 'nor its dashboard');
select is((select count(*)::int from app.sale_facts('2c000000-0000-4000-8000-000000000001', (select f from rng), (select t from rng))),
  0, 'RLS: another store sees no rows even through the building blocks');

select tests.reset_role();
set local role anon;
select throws_ok($$ select * from public.report_summary('2c000000-0000-4000-8000-000000000001', now() - interval '1 day', now()) $$,
  '42501', null, 'anon cannot execute report functions');
select throws_ok($$ select * from public.dashboard_today('2c000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot execute dashboard_today');
reset role;

select * from finish();
rollback;
