-- Phase 7: returns with write-offs, customer soft delete.
begin;
\ir _helpers.psql
select plan(21);

select tests.create_user('owner@ret.test',   '1b000000-0000-4000-8000-000000000001');
select tests.create_user('cashier@ret.test', '1b000000-0000-4000-8000-000000000002');
select tests.create_store('1b000000-0000-4000-8000-000000000001', 'ret-shop', '2b000000-0000-4000-8000-000000000001');
select tests.add_member('2b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000002', 'cashier');
select tests.create_product('2b000000-0000-4000-8000-000000000001', 'RET-1', 20, '3b000000-0000-4000-8000-000000000001');
select tests.receive('1b000000-0000-4000-8000-000000000001', '2b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', 10, 8);
create temporary table s as
  select tests.sell('1b000000-0000-4000-8000-000000000002', '2b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000001', 4) as id;
create temporary table item as
  select si.id from public.sale_items si where si.sale_id = (select id from s);
grant select on s, item to authenticated;

-- --------------------------------------------------------- cashier cannot
select tests.authenticate_as('1b000000-0000-4000-8000-000000000002');
select throws_ok(
  format($$ select public.create_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'quantity', 1))) $$,
         (select id from s), (select id from item)),
  '42501', 'forbidden', 'cashiers cannot make returns');
select throws_ok(
  $$ insert into public.returns (store_id, sale_id, refund_total, refund_method)
     values ('2b000000-0000-4000-8000-000000000001', (select id from s), 1, 'cash') $$,
  '42501', null, 'cashiers cannot write returns directly');

-- ------------------------------------------- write-off: refund, no restock
select tests.authenticate_as('1b000000-0000-4000-8000-000000000001');
create temporary table r1 (id uuid);
grant all on r1 to authenticated;
insert into r1 select public.create_return((select id from s),
  jsonb_build_array(jsonb_build_object('sale_item_id', (select id from item), 'quantity', 1, 'restock', false)), 'Broken screen');
select tests.reset_role();
select is((select stock from public.products where id = '3b000000-0000-4000-8000-000000000001'), 6,
  'a written-off unit does not go back to stock (10 - 4 sold)');
select is((select restocked from public.return_items where return_id = (select id from r1)), false, 'the item is marked as not restocked');
select is((select refund_total from public.returns where id = (select id from r1)), 20.00::numeric, 'it is still refunded');
select is((select count(*)::int from public.stock_movements m join public.return_items ri on ri.id = m.ref_id where ri.return_id = (select id from r1)), 0,
  'no stock movement for a write-off');
select is((select status::text from public.sales where id = (select id from s)), 'partially_returned', 'sale partially returned');

-- ---------------------------------------------- restock (default true)
select tests.authenticate_as('1b000000-0000-4000-8000-000000000001');
create temporary table r2 (id uuid);
grant all on r2 to authenticated;
insert into r2 select public.create_return((select id from s),
  jsonb_build_array(jsonb_build_object('sale_item_id', (select id from item), 'quantity', 2)));
select throws_ok(
  format($$ select public.create_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'quantity', 2))) $$,
         (select id from s), (select id from item)),
  '23514', 'return_exceeds_sold', 'cannot return more than what is left (4 sold, 3 returned)');
select throws_ok(
  format($$ select public.create_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'quantity', 1, 'restock', 'yes'))) $$,
         (select id from s), (select id from item)),
  '22023', 'invalid_items', '"restock" must be a boolean');
select tests.reset_role();
select is((select stock from public.products where id = '3b000000-0000-4000-8000-000000000001'), 8, 'restocked units go back (6 + 2)');
select is((select stock from public.products where id = '3b000000-0000-4000-8000-000000000001'),
  (select sum(quantity)::int from public.stock_movements where product_id = '3b000000-0000-4000-8000-000000000001'),
  'stock = sum of movements, write-offs included');

-- ---------------------------------------------------------------- customers
insert into public.customers (id, store_id, name) values
  ('4b000000-0000-4000-8000-000000000001', '2b000000-0000-4000-8000-000000000001', 'With purchases'),
  ('4b000000-0000-4000-8000-000000000002', '2b000000-0000-4000-8000-000000000001', 'No purchases');
select tests.authenticate_as('1b000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.create_sale('2b000000-0000-4000-8000-000000000001',
       '[{"product_id":"3b000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"card","amount":20}]', gen_random_uuid(), '4b000000-0000-4000-8000-000000000001') $$,
  'a sale with a customer');

select tests.authenticate_as('1b000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ update public.customers set phone = '+1 555 0199' where id = '4b000000-0000-4000-8000-000000000002' $$,
  'cashiers can edit customers');
select throws_ok(
  $$ update public.customers set deleted_at = now() where id = '4b000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'cashiers cannot "delete" customers through UPDATE');
select throws_ok(
  $$ select public.delete_customer('4b000000-0000-4000-8000-000000000002') $$,
  '42501', 'forbidden', 'cashiers cannot delete customers');

select tests.authenticate_as('1b000000-0000-4000-8000-000000000001');
select is(public.delete_customer('4b000000-0000-4000-8000-000000000002'), 'deleted', 'a customer without sales is deleted');
select is(public.delete_customer('4b000000-0000-4000-8000-000000000001'), 'archived', 'a customer with sales is archived');
select throws_ok(
  $$ select public.create_sale('2b000000-0000-4000-8000-000000000001',
       '[{"product_id":"3b000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"card","amount":20}]', gen_random_uuid(), '4b000000-0000-4000-8000-000000000001') $$,
  'P0002', 'customer_not_found', 'archived customers cannot be used in new sales');
select tests.reset_role();
select is((select count(*)::int from public.customers where id = '4b000000-0000-4000-8000-000000000002'), 0, 'deleted for real');
select ok((select deleted_at is not null from public.customers where id = '4b000000-0000-4000-8000-000000000001'), 'archived keeps the row');
select is((select count(*)::int from public.sales where customer_id = '4b000000-0000-4000-8000-000000000001'), 1, 'its sale still points to it');

select * from finish();
rollback;
