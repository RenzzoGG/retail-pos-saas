-- Phase 9: access by subscription state (enforced by triggers) and the Stripe
-- webhook function apply_stripe_event (idempotent, ordered, service_role only).
begin;
\ir _helpers.psql
select plan(37);

select tests.create_user('owner@sub.test',   '1d000000-0000-4000-8000-000000000001');
select tests.create_user('cashier@sub.test', '1d000000-0000-4000-8000-000000000002');
select tests.create_user('admin@sub.test',   '1d000000-0000-4000-8000-000000000003');
-- S: no subscription yet (setup mode). W: target of the webhook tests.
select tests.create_store('1d000000-0000-4000-8000-000000000001', 'sub-shop', '2d000000-0000-4000-8000-000000000001', p_subscribed => false);
select tests.create_store('1d000000-0000-4000-8000-000000000001', 'hook-shop', '2d000000-0000-4000-8000-000000000002', p_subscribed => false);
select tests.add_member('2d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000002', 'cashier');
select tests.add_member('2d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000003', 'admin');
select tests.create_product('2d000000-0000-4000-8000-000000000001', 'SUB-1', 10, '3d000000-0000-4000-8000-000000000001');

-- A cashier sale of 1 x SUB-1 (10.00, tax included), as SQL text for throws_ok/lives_ok.
create temporary table q (sale text);
insert into q values (
  $$ select public.create_sale('2d000000-0000-4000-8000-000000000001',
       '[{"product_id":"3d000000-0000-4000-8000-000000000001","quantity":1}]',
       '[{"method":"cash","amount":10}]', gen_random_uuid()) $$);
grant select on q to authenticated;

-- ===================================================== setup (no subscription)
select is(app.store_access('2d000000-0000-4000-8000-000000000001'), 'setup', 'no subscription = setup');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ insert into public.products (store_id, sku, name, sale_price) values ('2d000000-0000-4000-8000-000000000001', 'SUB-2', 'Second', 5) $$,
  'setup: the owner creates products');
select lives_ok(
  $$ select public.create_stock_entry('2d000000-0000-4000-8000-000000000001',
       '[{"product_id":"3d000000-0000-4000-8000-000000000001","quantity":10,"unit_cost":4}]') $$,
  'setup: the owner receives stock');
select lives_ok(
  $$ insert into public.customers (store_id, name) values ('2d000000-0000-4000-8000-000000000001', 'Early customer') $$,
  'setup: customers can be added');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000002');
select throws_ok((select sale from q), '42501', 'subscription_inactive', 'setup: the cashier cannot sell');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000001');
select throws_ok((select sale from q), '42501', 'subscription_inactive', 'setup: not even the owner can sell');
select tests.reset_role();
select is((select stock from public.products where id = '3d000000-0000-4000-8000-000000000001'), 10, 'the blocked sale left the stock untouched');

-- ===================================================== trialing / past_due
select tests.set_subscription('2d000000-0000-4000-8000-000000000001', 'trialing');
select is(app.store_access('2d000000-0000-4000-8000-000000000001'), 'full', 'trialing = full access');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000002');
create temporary table sold (id uuid);
grant all on sold to authenticated;
insert into sold select public.create_sale('2d000000-0000-4000-8000-000000000001',
  '[{"product_id":"3d000000-0000-4000-8000-000000000001","quantity":2}]', '[{"method":"cash","amount":20}]', gen_random_uuid());
select is((select count(*)::int from sold), 1, 'trialing: the cashier sells');
select tests.reset_role();

select tests.set_subscription('2d000000-0000-4000-8000-000000000001', 'past_due');
select is(app.store_access('2d000000-0000-4000-8000-000000000001'), 'full', 'past_due = full access (with a warning in the app)');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000002');
select lives_ok((select sale from q), 'past_due: the cashier still sells');

-- ===================================================== canceled = read-only
select tests.reset_role();
select tests.set_subscription('2d000000-0000-4000-8000-000000000001', 'canceled');
select is(app.store_access('2d000000-0000-4000-8000-000000000001'), 'read_only', 'canceled = read-only');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000002');
select throws_ok((select sale from q), '42501', 'subscription_inactive', 'read-only: no sales');
select is((select count(*)::int from public.sales where store_id = '2d000000-0000-4000-8000-000000000001'), 2, 'read-only: sales can still be read');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ select public.create_return(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'quantity', 1))) $$,
         (select id from sold), (select si.id from public.sale_items si where si.sale_id = (select id from sold))),
  '42501', 'subscription_inactive', 'read-only: no returns');
select throws_ok(
  $$ insert into public.products (store_id, sku, name, sale_price) values ('2d000000-0000-4000-8000-000000000001', 'SUB-3', 'Third', 5) $$,
  '42501', 'subscription_inactive', 'read-only: no new products');
select throws_ok(
  $$ update public.products set sale_price = 11 where id = '3d000000-0000-4000-8000-000000000001' $$,
  '42501', 'subscription_inactive', 'read-only: no product edits');
select throws_ok(
  $$ select public.create_stock_entry('2d000000-0000-4000-8000-000000000001',
       '[{"product_id":"3d000000-0000-4000-8000-000000000001","quantity":1,"unit_cost":4}]') $$,
  '42501', 'subscription_inactive', 'read-only: no stock entries');
select throws_ok(
  $$ insert into public.customers (store_id, name) values ('2d000000-0000-4000-8000-000000000001', 'Late customer') $$,
  '42501', 'subscription_inactive', 'read-only: no new customers');
select lives_ok(
  $$ update public.stores set ticket_footer = 'See you soon' where id = '2d000000-0000-4000-8000-000000000001' $$,
  'read-only: Settings still work (to keep the store usable for billing)');
select lives_ok(
  $$ insert into public.invitations (store_id, email, role, token_hash, expires_at)
     values ('2d000000-0000-4000-8000-000000000001', 'x@sub.test', 'cashier', 'h-sub', now() + interval '1 day') $$,
  'read-only: Team still works');
select tests.reset_role();

-- Every status, mapped like app.store_access says.
create temporary table access_by_status (status text, access text);
do $$
declare v_status public.subscription_status;
begin
  foreach v_status in array enum_range(null::public.subscription_status) loop
    perform tests.set_subscription('2d000000-0000-4000-8000-000000000001', v_status);
    insert into access_by_status values (v_status::text, app.store_access('2d000000-0000-4000-8000-000000000001'));
  end loop;
end $$;
select results_eq(
  $$ select status, access from access_by_status order by status $$,
  $$ values ('active', 'full'), ('canceled', 'read_only'), ('incomplete', 'setup'), ('incomplete_expired', 'read_only'),
            ('past_due', 'full'), ('paused', 'read_only'), ('trialing', 'full'), ('unpaid', 'read_only') $$,
  'access for every subscription status');

-- ===================================================== apply_stripe_event
select tests.act_as_service_role();
select is(public.apply_stripe_event('evt_1', 'customer.subscription.created', '2026-11-01 10:00+00',
  '{"store_id":"2d000000-0000-4000-8000-000000000002","customer_id":"cus_W","subscription_id":"sub_W","status":"trialing",
    "price_id":"price_X","trial_end":"2026-11-15T10:00:00Z","current_period_end":"2026-11-15T10:00:00Z","cancel_at_period_end":false}'),
  'processed', 'a subscription event is applied');
select is(public.apply_stripe_event('evt_1', 'customer.subscription.created', '2026-11-01 10:00+00',
  '{"store_id":"2d000000-0000-4000-8000-000000000002","status":"canceled"}'),
  'duplicate', 'the same event id again is not processed (even with other data)');
select tests.reset_role();
select results_eq(
  $$ select stripe_customer_id, stripe_subscription_id, status::text, price_id, trial_end, cancel_at_period_end
     from public.subscriptions where store_id = '2d000000-0000-4000-8000-000000000002' $$,
  $$ values ('cus_W', 'sub_W', 'trialing', 'price_X', timestamptz '2026-11-15T10:00:00Z', false) $$,
  'subscriptions reflects the first event only');
select is((select count(*)::int from public.stripe_events where id = 'evt_1'), 1, 'one row per event id');

select tests.act_as_service_role();
select is(public.apply_stripe_event('evt_0', 'customer.subscription.updated', '2026-11-01 09:00+00',
  '{"store_id":"2d000000-0000-4000-8000-000000000002","status":"canceled"}'),
  'stale', 'an older event delivered late does not overwrite newer state');
-- checkout.session.completed only links ids: it never makes a later-delivered status event stale.
select is(public.apply_stripe_event('evt_co', 'checkout.session.completed', '2026-11-01 12:00+00',
  '{"store_id":"2d000000-0000-4000-8000-000000000002","customer_id":"cus_W","subscription_id":"sub_W"}'),
  'processed', 'checkout completed links the ids');
select is(public.apply_stripe_event('evt_2', 'invoice.payment_failed', '2026-11-01 11:00+00',
  '{"store_id":"2d000000-0000-4000-8000-000000000002","status":"past_due"}'),
  'processed', 'a status event created before the checkout event still applies');
select is(public.apply_stripe_event('evt_x', 'customer.subscription.updated', '2026-11-01 13:00+00',
  '{"store_id":"9d000000-0000-4000-8000-000000000999","status":"active"}'),
  'ignored', 'unknown store: ignored (and recorded)');
select is(public.apply_stripe_event('evt_y', 'customer.subscription.trial_will_end', '2026-11-01 13:00+00', null),
  'ignored', 'events with nothing to apply are recorded as ignored');
select tests.reset_role();
select is((select status::text from public.subscriptions where store_id = '2d000000-0000-4000-8000-000000000002'), 'past_due', 'final state: past_due');
select is((select result from public.stripe_events where id = 'evt_x'), 'ignored', 'the result is stored with the event');

-- Only the server (service_role) may call it.
select tests.authenticate_as('1d000000-0000-4000-8000-000000000001');
select throws_ok($$ select public.apply_stripe_event('evt_owner', 't', now(), '{"store_id":"2d000000-0000-4000-8000-000000000002","status":"active"}') $$,
  '42501', null, 'an owner cannot apply Stripe events (no self-activation)');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000003');
select throws_ok($$ select public.apply_stripe_event('evt_admin', 't', now(), '{}') $$, '42501', null, 'an admin cannot apply Stripe events');
select tests.authenticate_as('1d000000-0000-4000-8000-000000000002');
select throws_ok($$ select public.apply_stripe_event('evt_cashier', 't', now(), '{}') $$, '42501', null, 'a cashier cannot apply Stripe events');
select tests.reset_role();
set local role anon;
select throws_ok($$ select public.apply_stripe_event('evt_anon', 't', now(), '{}') $$, '42501', null, 'anon cannot apply Stripe events');
reset role;

select * from finish();
rollback;
