-- Stripe tables: only the server (service_role, Stripe webhook) writes them.
-- Members may read their own store's subscription status to gate access.
begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('owner1@bill.test', '15000000-0000-4000-8000-000000000001');
select tests.create_user('owner2@bill.test', '15000000-0000-4000-8000-000000000002');
select tests.create_store('15000000-0000-4000-8000-000000000001', 'bill-one', '25000000-0000-4000-8000-000000000001', p_subscribed => false);
select tests.create_store('15000000-0000-4000-8000-000000000002', 'bill-two', '25000000-0000-4000-8000-000000000002', p_subscribed => false);

-- The webhook (service_role) can write both tables.
select tests.act_as_service_role();
select lives_ok(
  $$ insert into public.stripe_events (id, type) values ('evt_test_1', 'customer.subscription.created') $$,
  'service_role records Stripe events');
select lives_ok(
  $$ insert into public.subscriptions (store_id, stripe_customer_id, status, trial_end) values
       ('25000000-0000-4000-8000-000000000001', 'cus_one', 'trialing', now() + interval '14 days'),
       ('25000000-0000-4000-8000-000000000002', 'cus_two', 'active', null) $$,
  'service_role writes subscriptions');
select tests.reset_role();

-- An owner (most privileged app user) cannot touch them.
select tests.authenticate_as('15000000-0000-4000-8000-000000000001');
select throws_ok($$ select * from public.stripe_events $$, '42501', null, 'owner cannot read Stripe events');
select throws_ok($$ insert into public.stripe_events (id, type) values ('evt_fake', 'x') $$, '42501', null, 'owner cannot forge Stripe events');
select throws_ok(
  $$ update public.subscriptions set status = 'active' where store_id = '25000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'owner cannot activate its own subscription');
select throws_ok(
  $$ insert into public.subscriptions (store_id, stripe_customer_id, status)
     values ('25000000-0000-4000-8000-000000000001', 'cus_fake', 'active') $$,
  '42501', null, 'owner cannot create a subscription');
select throws_ok($$ delete from public.subscriptions $$, '42501', null, 'owner cannot delete subscriptions');
select is((select status::text from public.subscriptions), 'trialing', 'owner reads only its own store subscription');
select is((select count(*)::int from public.subscriptions), 1, 'the other store subscription is invisible');

select * from finish();
rollback;
