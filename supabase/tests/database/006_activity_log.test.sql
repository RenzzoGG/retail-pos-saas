-- Activity log: written automatically by triggers, readable by owner/admin,
-- and immutable for everyone (no edits, no deletes, no truncate).
begin;
\ir _helpers.psql
select plan(14);

select tests.create_user('owner@log.test', '14000000-0000-4000-8000-000000000001');
select tests.create_store('14000000-0000-4000-8000-000000000001', 'log-shop', '24000000-0000-4000-8000-000000000001');

-- Changes made by the owner through the normal API are logged with the actor.
select tests.authenticate_as('14000000-0000-4000-8000-000000000001');
insert into public.products (store_id, sku, name, sale_price)
  values ('24000000-0000-4000-8000-000000000001', 'L-1', 'Logged product', 10);
update public.products set sale_price = 12 where sku = 'L-1';
insert into public.invitations (store_id, email, role, token_hash, expires_at)
  values ('24000000-0000-4000-8000-000000000001', 'inv@log.test', 'cashier', 'secret-hash', now() + interval '1 day');

select is((select count(*)::int from public.activity_log where table_name = 'products' and action = 'insert'), 1, 'product insert logged');
select is((select actor_id from public.activity_log where table_name = 'products' and action = 'insert'),
  '14000000-0000-4000-8000-000000000001'::uuid, 'the actor is the signed-in user');
select is((select (before ->> 'sale_price') || ' -> ' || (after ->> 'sale_price')
           from public.activity_log where table_name = 'products' and action = 'update'),
  '10.00 -> 12.00', 'updates keep the before and after values');
select ok((select not (after ? 'token_hash') from public.activity_log where table_name = 'invitations'),
  'invitation token hashes are never copied into the log');

-- Stock-only changes (sales) are not duplicated here: stock_movements is their history.
select tests.reset_role();
select tests.receive('14000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001',
  (select id from public.products where sku = 'L-1'), 5, 3);
select is((select count(*)::int from public.activity_log where table_name = 'products' and action = 'update'), 1,
  'stock-only updates do not add product log rows');

-- ----------------------------------------- the app cannot edit or delete it
select tests.authenticate_as('14000000-0000-4000-8000-000000000001');
select ok((select count(*) > 0 from public.activity_log), 'owner can read the activity log');
select throws_ok($$ update public.activity_log set action = 'delete' $$, '42501', null, 'owner cannot edit the log');
select throws_ok($$ delete from public.activity_log $$, '42501', null, 'owner cannot delete the log');
select throws_ok(
  $$ insert into public.activity_log (store_id, table_name, record_id, action)
     values ('24000000-0000-4000-8000-000000000001', 'products', 'x', 'delete') $$,
  '42501', null, 'owner cannot forge log entries');

-- Not even the server key or postgres can rewrite history.
select tests.act_as_service_role();
select throws_ok($$ update public.activity_log set action = 'delete' $$, '42501', 'activity_log_is_append_only', 'service_role cannot edit the log');
select throws_ok($$ delete from public.activity_log $$, '42501', 'activity_log_is_append_only', 'service_role cannot delete the log');
select tests.reset_role();
select throws_ok($$ delete from public.activity_log $$, '42501', 'activity_log_is_append_only', 'postgres cannot delete the log');
select throws_ok($$ truncate public.activity_log $$, '42501', 'activity_log_is_append_only', 'postgres cannot truncate the log');
select ok((select count(*) >= 4 from public.activity_log where store_id = '24000000-0000-4000-8000-000000000001'), 'all log rows are still there');

select * from finish();
rollback;
