-- Invitations and team management rules:
--   owner invites/manages admins and cashiers; admin only cashiers;
--   accept_invitation checks token, expiry, single use and email.
begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('owner@inv.test',   '17000000-0000-4000-8000-000000000001');
select tests.create_user('admin@inv.test',   '17000000-0000-4000-8000-000000000002');
select tests.create_user('cashier@inv.test', '17000000-0000-4000-8000-000000000003');
select tests.create_user('guest@inv.test',   '17000000-0000-4000-8000-000000000004');
select tests.create_user('other@inv.test',   '17000000-0000-4000-8000-000000000005');
select tests.create_user('admin2@inv.test',  '17000000-0000-4000-8000-000000000006');
select tests.create_store('17000000-0000-4000-8000-000000000001', 'inv-shop', '27000000-0000-4000-8000-000000000001');
select tests.add_member('27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000002', 'admin');
select tests.add_member('27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000003', 'cashier');
select tests.add_member('27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000006', 'admin');

-- Invitation rows with known tokens (the app stores only the SHA-256 hash).
insert into public.invitations (store_id, email, role, token_hash, expires_at) values
  ('27000000-0000-4000-8000-000000000001', 'guest@inv.test', 'cashier', app.hash_token('valid-token-guest-0000000000'), now() + interval '7 days'),
  ('27000000-0000-4000-8000-000000000001', 'other@inv.test', 'admin',   app.hash_token('expired-token-other-00000000'), now() - interval '1 minute');

-- profiles.email is filled from auth.users
select is((select email from public.profiles where id = '17000000-0000-4000-8000-000000000004'), 'guest@inv.test', 'profiles.email is copied from auth.users');

-- --------------------------------------------------------- who may invite
select tests.authenticate_as('17000000-0000-4000-8000-000000000002');  -- admin
select lives_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('27000000-0000-4000-8000-000000000001', 'new-cashier@inv.test', 'cashier', 'h-1', now() + interval '7 days') $$,
  'admin can invite a cashier');
select throws_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('27000000-0000-4000-8000-000000000001', 'new-admin@inv.test', 'admin', 'h-2', now() + interval '7 days') $$,
  '42501', null, 'admin cannot invite an admin');
select is((select invited_by from public.invitations where email = 'new-cashier@inv.test'),
  '17000000-0000-4000-8000-000000000002'::uuid, 'invited_by comes from the session');
-- Admin cannot touch other admins: 0 rows affected (checked below).
update public.store_members set role = 'cashier' where user_id = '17000000-0000-4000-8000-000000000006';
delete from public.store_members where user_id = '17000000-0000-4000-8000-000000000006';
select throws_ok(
  $$ update public.store_members set role = 'admin' where user_id = '17000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'admin cannot promote a cashier to admin');

select tests.authenticate_as('17000000-0000-4000-8000-000000000003');  -- cashier
select throws_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('27000000-0000-4000-8000-000000000001', 'x@inv.test', 'cashier', 'h-3', now() + interval '7 days') $$,
  '42501', null, 'cashier cannot invite');

select tests.authenticate_as('17000000-0000-4000-8000-000000000001');  -- owner
select lives_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('27000000-0000-4000-8000-000000000001', 'new-admin@inv.test', 'admin', 'h-4', now() + interval '7 days') $$,
  'owner can invite an admin');
select throws_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('27000000-0000-4000-8000-000000000001', 'boss@inv.test', 'owner', 'h-5', now() + interval '7 days') $$,
  '23514', null, 'nobody can invite an owner (table CHECK)');
select throws_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('27000000-0000-4000-8000-000000000001', 'new-admin@inv.test', 'cashier', 'h-6', now() + interval '7 days') $$,
  '23505', null, 'only one pending invitation per email and store');

select tests.reset_role();
select is((select role::text from public.store_members where user_id = '17000000-0000-4000-8000-000000000006'), 'admin', 'admin could not demote another admin');
select is((select count(*)::int from public.store_members where user_id = '17000000-0000-4000-8000-000000000006'), 1, 'admin could not remove another admin');

-- ---------------------------------------------------------- preview
select tests.authenticate_as('17000000-0000-4000-8000-000000000004');
select is((select store_name || '|' || role || '|' || status from public.invitation_preview('valid-token-guest-0000000000')),
  'Inv Shop|cashier|pending', 'preview shows store, role and status');
select is((select status from public.invitation_preview('expired-token-other-00000000')), 'expired', 'preview reports expired invitations');
select is_empty($$ select * from public.invitation_preview('no-such-token-000000000000') $$, 'unknown tokens reveal nothing');

-- ---------------------------------------------------------- accepting
select tests.authenticate_as('17000000-0000-4000-8000-000000000005');  -- other@ (wrong email)
select throws_ok($$ select public.accept_invitation('valid-token-guest-0000000000') $$,
  '42501', 'invitation_email_mismatch', 'an invitation only works for the invited email');
select throws_ok($$ select public.accept_invitation('expired-token-other-00000000') $$,
  '22023', 'invitation_expired', 'expired invitations are rejected');
select throws_ok($$ select public.accept_invitation('no-such-token-000000000000') $$,
  'P0002', 'invitation_not_found', 'invalid tokens are rejected');
select throws_ok($$ select public.accept_invitation('short') $$,
  'P0002', 'invitation_not_found', 'malformed tokens are rejected');

select tests.authenticate_as('17000000-0000-4000-8000-000000000004');  -- guest@ (right email)
select is(public.accept_invitation('valid-token-guest-0000000000'), '27000000-0000-4000-8000-000000000001'::uuid,
  'the invited user accepts and gets the store id');
select is((select role::text from public.store_members where user_id = '17000000-0000-4000-8000-000000000004'), 'cashier',
  'membership created with the invited role');
select is((select count(*)::int from public.products), 0, 'the new member can now query the store (RLS sees the membership)');
select throws_ok($$ select public.accept_invitation('valid-token-guest-0000000000') $$,
  '22023', 'invitation_already_used', 'an invitation can be used only once');

select tests.reset_role();
select ok((select accepted_at is not null and accepted_by = '17000000-0000-4000-8000-000000000004'
           from public.invitations where email = 'guest@inv.test'), 'invitation marked as accepted by the user');

-- An existing member cannot accept a second invitation to the same store.
insert into public.invitations (store_id, email, role, token_hash, expires_at) values
  ('27000000-0000-4000-8000-000000000001', 'cashier@inv.test', 'cashier', app.hash_token('dup-token-cashier-0000000000'), now() + interval '7 days');
select tests.authenticate_as('17000000-0000-4000-8000-000000000003');
select throws_ok($$ select public.accept_invitation('dup-token-cashier-0000000000') $$,
  '23505', 'already_member', 'members cannot accept another invitation to the same store');

-- Signed-out users cannot use the functions; clients cannot hash tokens themselves.
select tests.reset_role();
select ok(not has_function_privilege('anon', 'public.accept_invitation(text)', 'EXECUTE'), 'anon cannot accept invitations');
select ok(not has_function_privilege('authenticated', 'app.hash_token(text)', 'EXECUTE'), 'clients cannot call the token hash helper');

select * from finish();
rollback;
