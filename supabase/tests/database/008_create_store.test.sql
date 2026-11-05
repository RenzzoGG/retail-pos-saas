-- create_store: store + settings + owner membership in one atomic step.
begin;
\ir _helpers.psql
select plan(13);

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

select tests.reset_role();
select throws_ok($$ set local role anon; select public.create_store('Anon shop', 'USD', 0, true) $$, '42501', null, 'signed-out users cannot create stores');

select * from finish();
rollback;
