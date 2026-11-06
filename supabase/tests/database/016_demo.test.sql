-- Phase 11: public demo. reset_demo_store() rebuilds only the demo store, is
-- idempotent, undoes visitor changes and is service_role only; a locked demo
-- store (is_demo) refuses team, invitation, settings and new-store changes
-- from its users while selling keeps working. Runs on the local seed.
begin;
\ir _helpers.psql
select plan(25);

create temporary table ids (k text primary key, v uuid);
insert into ids values
  ('demo',    'b0000000-0000-4000-8000-000000000001'),
  ('other',   'b0000000-0000-4000-8000-000000000002'),
  ('owner',   'a0000000-0000-4000-8000-000000000001'),
  ('admin',   'a0000000-0000-4000-8000-000000000002'),
  ('cashier', 'a0000000-0000-4000-8000-000000000003'),
  ('oscar',   'a0000000-0000-4000-8000-000000000004');
grant select on ids to authenticated, service_role;

create temporary table snap (k text primary key, v text);
grant all on snap to authenticated, service_role;
insert into snap
select 'other', count(*)::text || ':' || coalesce(sum(stock), 0) from public.products
where store_id = (select v from ids where k = 'other');

-- ============================================================ permissions
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.reset_demo_store('x') $$, '42501', null, 'a signed-in user (even the demo owner) cannot reset the demo');
select tests.reset_role();
set local role anon;
select throws_ok($$ select public.reset_demo_store('x') $$, '42501', null, 'anon cannot reset the demo');
select tests.reset_role();

-- ============================================================ vandalism, then reset
update public.stores set name = 'Vandalized' where id = 'b0000000-0000-4000-8000-000000000001';
update public.products set sale_price = 0.01 where store_id = 'b0000000-0000-4000-8000-000000000001';
update auth.users set email = 'thief@example.com' where id = 'a0000000-0000-4000-8000-000000000003';
delete from public.store_members where user_id = 'a0000000-0000-4000-8000-000000000002'
  and store_id = 'b0000000-0000-4000-8000-000000000001';

select tests.act_as_service_role();
select lives_ok($$ insert into snap select 'r1', public.reset_demo_store('demo-test-pw')::text $$, 'service_role resets the demo');
select tests.reset_role();

select is((select name from public.stores where id = 'b0000000-0000-4000-8000-000000000001'), 'Stocktill Demo Electronics', 'store name restored');
select ok((select is_demo from public.stores where id = 'b0000000-0000-4000-8000-000000000001'), 'the demo store is locked (is_demo)');
select is((select min(sale_price) from public.products where store_id = 'b0000000-0000-4000-8000-000000000001'), 8.99::numeric, 'catalog prices restored');
select is((select email from auth.users where id = 'a0000000-0000-4000-8000-000000000003'), 'cashier@demo.stocktill.test', 'demo email restored');
select ok((select encrypted_password = extensions.crypt('demo-test-pw', encrypted_password) from auth.users where id = 'a0000000-0000-4000-8000-000000000002'), 'demo password set to the given one');
select is((select string_agg(role::text, ',' order by role) from public.store_members where store_id = 'b0000000-0000-4000-8000-000000000001'),
          'owner,admin,cashier', 'the three demo memberships are back');
select ok((select (v::jsonb ->> 'sales')::int > 300 from snap where k = 'r1'), '60 days of sales were generated');
select is((select count(*)::int from public.subscriptions where store_id = 'b0000000-0000-4000-8000-000000000001' and status = 'active'), 1, 'active complimentary subscription');
select is_empty($$
  select p.id from public.products p
  left join public.stock_movements m on m.product_id = p.id
  where p.store_id = 'b0000000-0000-4000-8000-000000000001'
  group by p.id, p.stock having p.stock <> coalesce(sum(m.quantity), 0)
$$, 'stock = sum of movements for every demo product');
select is((select v from snap where k = 'other'),
          (select count(*)::text || ':' || coalesce(sum(stock), 0) from public.products where store_id = 'b0000000-0000-4000-8000-000000000002'),
          'other stores are untouched');

select tests.act_as_service_role();
select lives_ok($$ insert into snap select 'r2', public.reset_demo_store('demo-test-pw')::text $$, 'a second reset works too');
select tests.reset_role();
select is((select v::jsonb - 'credentials' from snap where k = 'r2'), (select v::jsonb - 'credentials' from snap where k = 'r1'), 'reset is idempotent (same sales and returns)');

-- ============================================================ locks for demo users
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001');
select throws_ok($$ update public.stores set name = 'Mine now' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  '42501', 'demo_locked', 'demo owner cannot change store settings');
select throws_ok($$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
                    values ('b0000000-0000-4000-8000-000000000001', 'victim@example.com', 'cashier', 'h', now() + interval '1 day') $$,
  '42501', 'demo_locked', 'demo owner cannot send invitations (no email abuse)');
select throws_ok($$ update public.store_members set role = 'admin' where user_id = 'a0000000-0000-4000-8000-000000000003' $$,
  '42501', 'demo_locked', 'demo owner cannot change roles');
select throws_ok($$ delete from public.store_members where user_id = 'a0000000-0000-4000-8000-000000000003' $$,
  '42501', 'demo_locked', 'demo owner cannot remove members');
select throws_ok($$ select public.create_store('Side business', 'USD', 0, true) $$,
  '42501', 'demo_locked', 'demo accounts cannot create other stores');
select throws_ok($$ update public.profiles set full_name = 'Someone else' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', 'demo_locked', 'demo accounts cannot rename themselves');
select lives_ok($$ insert into public.customers (store_id, name) values ('b0000000-0000-4000-8000-000000000001', 'Visitor') $$,
  'but the demo is usable: customers can be added');
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003');
select lives_ok($$ select public.create_sale('b0000000-0000-4000-8000-000000000001',
                     '[{"product_id":"c0000000-0000-4000-8000-000000000001","quantity":1}]',
                     '[{"method":"card","amount":9.99}]', gen_random_uuid()) $$,
  'and the demo cashier can sell');

-- Other stores are not affected by the demo locks.
select tests.authenticate_as('a0000000-0000-4000-8000-000000000004');
select lives_ok($$ update public.stores set ticket_footer = 'Gracias' where id = 'b0000000-0000-4000-8000-000000000002' $$,
  'a regular owner still edits their store');

-- ============================================================ missing users
select tests.reset_role();
update auth.users set raw_app_meta_data = raw_app_meta_data - 'demo_role' where id = 'a0000000-0000-4000-8000-000000000003';
select tests.act_as_service_role();
select throws_ok($$ select public.reset_demo_store() $$, 'P0001', 'demo_users_missing', 'fails clearly when the demo users are not provisioned');
select tests.reset_role();

select * from finish();
rollback;
