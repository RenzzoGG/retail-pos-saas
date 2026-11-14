-- create_store: store + settings + owner membership in one atomic step.
begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('founder@cs.test', '16000000-0000-4000-8000-000000000001');
select tests.create_user('outsider@cs.test', '16000000-0000-4000-8000-000000000002');

select tests.authenticate_as('16000000-0000-4000-8000-000000000001');
create temporary table new_store as
  select public.create_store('Café & Gadgets!', 'usd', 0.0825, true) as id;

select is((select count(*)::int from public.stores), 1, 'the founder sees the new store');
select is((select name from public.stores where id = (select id from new_store)), 'Café & Gadgets!', 'name stored as typed (trimmed)');
select is((select currency from public.stores where id = (select id from new_store)), 'USD', 'currency normalized to upper case');
select is((select tax_rate from public.stores where id = (select id from new_store)), 0.0825::numeric, 'tax rate stored');
select is((select prices_include_tax from public.stores where id = (select id from new_store)), true, 'prices-include-tax flag stored');
select matches((select slug from public.stores where id = (select id from new_store)), '^caf-gadgets-[0-9a-f]{6}$', 'URL-friendly slug with random suffix');
select is((select role::text from public.store_members where store_id = (select id from new_store)
           and user_id = '16000000-0000-4000-8000-000000000001'), 'owner', 'creator becomes owner');

select throws_ok($$ select public.create_store(' ', 'USD', 0, true) $$, '22023', 'invalid_store_name', 'blank names are rejected');
select throws_ok($$ select public.create_store('Shop', 'US', 0, true) $$, '22023', 'invalid_currency', 'currency must be a 3-letter code');
select throws_ok($$ select public.create_store('Shop', 'USD', 1.5, true) $$, '22023', 'invalid_tax_rate', 'tax rate must be below 100 %');

-- Atomicity: a failed call leaves neither a store nor a membership behind.
select is((select count(*)::int from public.store_members where user_id = '16000000-0000-4000-8000-000000000001'), 1, 'failed calls created nothing');

select tests.authenticate_as('16000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.stores), 0, 'other users cannot see the new store');

-- Idempotency: the onboarding form sends one key per page view; a double
-- submit (or a retry) must return the first store, not create a second one.
select tests.authenticate_as('16000000-0000-4000-8000-000000000001');
create temporary table first_try as
  select public.create_store('Twice Shop', 'USD', 0, true, 'UTC', 'e1000000-0000-4000-8000-000000000001') as id;
create temporary table second_try as
  select public.create_store('Twice Shop', 'USD', 0, true, 'UTC', 'e1000000-0000-4000-8000-000000000001') as id;
select is((select id from second_try), (select id from first_try), 'repeating the idempotency key returns the same store');
select is((select count(*)::int from public.stores where name = 'Twice Shop'), 1, 'a double submit creates one store');
select is((select count(*)::int from public.store_members where store_id = (select id from first_try)), 1, 'a double submit creates one membership');
select isnt(public.create_store('Twice Shop', 'USD', 0, true, 'UTC', 'e1000000-0000-4000-8000-000000000002'),
  (select id from first_try), 'a new key creates a new store');
select throws_ok($$ update public.stores set idempotency_key = gen_random_uuid() where id = (select id from first_try) $$,
  '42501', null, 'the idempotency key is not client-writable');

select tests.authenticate_as('16000000-0000-4000-8000-000000000002');
select isnt(public.create_store('Twice Shop', 'USD', 0, true, 'UTC', 'e1000000-0000-4000-8000-000000000001'),
  (select id from first_try), 'the same key from another user creates their own store');

select tests.reset_role();
select throws_ok($$ set local role anon; select public.create_store('Anon shop', 'USD', 0, true) $$, '42501', null, 'signed-out users cannot create stores');

select * from finish();
rollback;
