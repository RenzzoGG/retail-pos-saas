-- Behaviour of create_stock_entry, create_sale and create_return:
-- weighted average cost, totals, taxes, numbering, idempotency, refunds.
begin;
\ir _helpers.psql
select plan(34);

select tests.create_user('owner@fn.test',   '13000000-0000-4000-8000-000000000001');
select tests.create_user('cashier@fn.test', '13000000-0000-4000-8000-000000000002');
-- Store with tax INCLUDED in prices (8.25 %).
select tests.create_store('13000000-0000-4000-8000-000000000001', 'fn-incl', '23000000-0000-4000-8000-000000000001', 0.0825, true);
select tests.add_member('23000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', 'cashier');
select tests.create_product('23000000-0000-4000-8000-000000000001', 'P1', 10.00, '33000000-0000-4000-8000-000000000001');
select tests.create_product('23000000-0000-4000-8000-000000000001', 'P2', 25.00, '33000000-0000-4000-8000-000000000002');

-- ------------------------------------------------------- stock entries
select tests.receive('13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 10, 4.00);
select is((select cost_price from public.product_costs where product_id = '33000000-0000-4000-8000-000000000001'), 4.00::numeric, 'first entry sets the cost');
select tests.receive('13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 10, 6.00);
select is((select cost_price from public.product_costs where product_id = '33000000-0000-4000-8000-000000000001'), 5.00::numeric, 'weighted average: (10*4 + 10*6) / 20 = 5.00');
select is((select stock from public.products where id = '33000000-0000-4000-8000-000000000001'), 20, 'entries add stock');
select tests.receive('13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000002', 5, 12.00);
select is((select count(*)::int from public.stock_entries where store_id = '23000000-0000-4000-8000-000000000001'), 3, 'one stock_entries row per entry');

select tests.authenticate_as('13000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.create_stock_entry('23000000-0000-4000-8000-000000000001',
       '[{"product_id":"33000000-0000-4000-8000-000000000001","quantity":1,"unit_cost":1},
         {"product_id":"33000000-0000-4000-8000-000000000001","quantity":2,"unit_cost":1}]') $$,
  '22023', 'duplicate_product', 'the same product cannot appear twice in an entry');
select throws_ok(
  $$ select public.create_stock_entry('23000000-0000-4000-8000-000000000001',
       '[{"product_id":"33000000-0000-4000-8000-000000000001","quantity":1,"unit_cost":-3}]') $$,
  '22023', 'invalid_amount', 'negative unit cost is rejected');
select tests.reset_role();

-- ------------------------------------------------------- a full sale
-- P1 x2 with 1.00 line discount = 19.00; P2 x1 = 25.00; subtotal 44.00;
-- sale discount 4.00 -> 40.00 (tax included): tax = round(40 * 0.0825 / 1.0825, 2) = 3.05.
-- Paid 30.00 cash (50.00 tendered) + 10.00 card.
create temporary table sale1 (id uuid);
grant all on sale1 to authenticated;
select tests.authenticate_as('13000000-0000-4000-8000-000000000002');
insert into sale1 select public.create_sale(
  '23000000-0000-4000-8000-000000000001',
  '[{"product_id":"33000000-0000-4000-8000-000000000001","quantity":2,"discount":1.00},
    {"product_id":"33000000-0000-4000-8000-000000000002","quantity":1}]',
  '[{"method":"cash","amount":30.00,"tendered":50.00},{"method":"card","amount":10.00}]',
  '53000000-0000-4000-8000-000000000001', null, 4.00);
select tests.reset_role();

select is((select number from public.sales where id = (select id from sale1)), 1, 'first sale gets number 1');
select is((select subtotal from public.sales where id = (select id from sale1)), 44.00::numeric, 'subtotal = sum of line totals after line discounts');
select is((select discount_total from public.sales where id = (select id from sale1)), 4.00::numeric, 'sale-level discount stored');
select is((select total from public.sales where id = (select id from sale1)), 40.00::numeric, 'tax-included total = subtotal - discount');
select is((select tax_total from public.sales where id = (select id from sale1)), 3.05::numeric, 'included tax extracted from the total');
select is((select cashier_id from public.sales where id = (select id from sale1)), '13000000-0000-4000-8000-000000000002'::uuid, 'cashier recorded from the session');
select is((select count(*)::int from public.sale_items where sale_id = (select id from sale1)), 2, 'two sale lines');
select is((select line_total from public.sale_items where sale_id = (select id from sale1) and sku = 'P1'), 19.00::numeric, 'line total = price * qty - line discount');
select is((select sic.unit_cost from public.sale_item_costs sic join public.sale_items si on si.id = sic.sale_item_id
           where si.sale_id = (select id from sale1) and si.sku = 'P1'), 5.00::numeric, 'cost snapshot uses the current average cost');
select is((select sum(amount) from public.sale_payments where sale_id = (select id from sale1)), 40.00::numeric, 'payments add up to the total');
select is((select stock from public.products where id = '33000000-0000-4000-8000-000000000001'), 18, 'stock decremented');

-- Idempotency: the same key returns the same sale and changes nothing.
select tests.authenticate_as('13000000-0000-4000-8000-000000000002');
select is(
  public.create_sale('23000000-0000-4000-8000-000000000001',
    '[{"product_id":"33000000-0000-4000-8000-000000000001","quantity":2,"discount":1.00},
      {"product_id":"33000000-0000-4000-8000-000000000002","quantity":1}]',
    '[{"method":"cash","amount":30.00,"tendered":50.00},{"method":"card","amount":10.00}]',
    '53000000-0000-4000-8000-000000000001', null, 4.00),
  (select id from sale1), 'repeating the idempotency key returns the same sale');
select throws_ok(
  $$ select public.create_sale('23000000-0000-4000-8000-000000000001',
       '[{"product_id":"33000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"cash","amount":9.00}]', gen_random_uuid()) $$,
  '22023', 'payments_mismatch', 'payments must equal the total');
select throws_ok(
  $$ select public.create_sale('23000000-0000-4000-8000-000000000001',
       '[{"product_id":"33000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"cash","amount":10.00}]', gen_random_uuid(), null, 11.00) $$,
  '22023', 'invalid_discount', 'discount cannot exceed the subtotal');
select throws_ok(
  $$ select public.create_sale('23000000-0000-4000-8000-000000000001',
       '[{"product_id":"33000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"cash","amount":5.00,"tendered":4.00},{"method":"card","amount":5.00}]', gen_random_uuid()) $$,
  '23514', null, 'cash tendered cannot be less than the amount');
select tests.reset_role();
select is((select stock from public.products where id = '33000000-0000-4000-8000-000000000001'), 18, 'idempotent retry and failed sales did not touch stock');
select is((select count(*)::int from public.sales where store_id = '23000000-0000-4000-8000-000000000001'), 1, 'still exactly one sale');

-- Next sale gets number 2.
create temporary table sale2 as
  select tests.sell('13000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000002', 1) as id;
select is((select number from public.sales where id = (select id from sale2)), 2, 'second sale gets number 2');

-- ---------------------------------------- store with tax ADDED (21 %)
select tests.create_store('13000000-0000-4000-8000-000000000001', 'fn-excl', '23000000-0000-4000-8000-000000000002', 0.21, false);
select tests.create_product('23000000-0000-4000-8000-000000000002', 'E1', 100.00, '33000000-0000-4000-8000-000000000003');
select tests.receive('13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000003', 3, 50);
create temporary table sale_excl as
  select tests.sell('13000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000003', 1) as id;
select is((select tax_total from public.sales where id = (select id from sale_excl)), 21.00::numeric, 'added tax = subtotal * rate');
select is((select total from public.sales where id = (select id from sale_excl)), 121.00::numeric, 'added-tax total = subtotal + tax');
select is((select number from public.sales where id = (select id from sale_excl)), 1, 'numbering is per store');

-- ------------------------------------------------------------- returns
-- Return 1 unit of P1 from sale 1: line share 19.00 * 1/2 = 9.50 of a 44.00
-- subtotal -> refund = round(40.00 * 9.50 / 44.00, 2) = 8.64.
select tests.authenticate_as('13000000-0000-4000-8000-000000000001');
create temporary table ret1 as
  select public.create_return((select id from sale1),
    (select jsonb_build_array(jsonb_build_object('sale_item_id', si.id, 'quantity', 1))
     from public.sale_items si where si.sale_id = (select id from sale1) and si.sku = 'P1'),
    'Defective', 'cash') as id;
select is((select refund_total from public.returns where id = (select id from ret1)), 8.64::numeric, 'refund is the line share of the total (discounts/taxes prorated)');
select is((select status::text from public.sales where id = (select id from sale1)), 'partially_returned', 'sale becomes partially_returned');
select throws_ok(
  format($$ select public.create_return(%L,
     (select jsonb_build_array(jsonb_build_object('sale_item_id', si.id, 'quantity', 2))
      from public.sale_items si where si.sale_id = %L and si.sku = 'P1')) $$,
     (select id from sale1), (select id from sale1)),
  '23514', 'return_exceeds_sold', 'cannot return more than sold minus already returned');

-- Return everything left: refund = 40.00 - 8.64 = 31.36 exactly.
create temporary table ret2 as
  select public.create_return((select id from sale1),
    (select jsonb_agg(jsonb_build_object('sale_item_id', si.id, 'quantity', 1))
     from public.sale_items si where si.sale_id = (select id from sale1))) as id;
select tests.reset_role();
select is((select refund_total from public.returns where id = (select id from ret2)), 31.36::numeric, 'completing the return refunds exactly the remainder');
select is((select sum(refund_total) from public.returns where sale_id = (select id from sale1)), 40.00::numeric, 'total refunded never exceeds the sale total');
select is((select status::text from public.sales where id = (select id from sale1)), 'returned', 'sale becomes returned');
select is((select stock from public.products where id = '33000000-0000-4000-8000-000000000001'), 20, 'returned units go back to stock');

select * from finish();
rollback;
