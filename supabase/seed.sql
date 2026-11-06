-- =============================================================================
-- Stocktill demo seed — LOCAL DEVELOPMENT ONLY.
--
-- Stocktill is a fictional brand. All people, stores, products and barcodes
-- here are made up (EAN-13 codes use the GS1 "200" in-store prefix).
--
-- Demo users (password for all: stocktill-demo — local only, never reuse it):
--   owner@demo.stocktill.test    owner   of "Stocktill Demo Electronics"
--   admin@demo.stocktill.test    admin   of "Stocktill Demo Electronics"
--   cashier@demo.stocktill.test  cashier of "Stocktill Demo Electronics"
--   owner@other.stocktill.test   owner   of "Other Shop" (isolation checks)
--
-- Stock and costs are loaded through create_stock_entry() and the demo sales
-- (60 days of history) through create_sale() / create_return(), so the ledger
-- is consistent (stock = sum of movements).
-- Runs automatically on `supabase db reset` / first `supabase start`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Users (auth.users + auth.identities so email/password login works locally).
-- -----------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('stocktill-demo', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb
    || case when u.demo_role is null then '{}'::jsonb else jsonb_build_object('demo_role', u.demo_role) end,
  jsonb_build_object('full_name', u.full_name), now(), now(),
  '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'owner@demo.stocktill.test',   'Olivia Owner',  'owner'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'admin@demo.stocktill.test',   'Adam Admin',    'admin'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'cashier@demo.stocktill.test', 'Carla Cashier', 'cashier'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'owner@other.stocktill.test',  'Oscar Other',   null)
) as u(id, email, full_name, demo_role);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email like '%.stocktill.test';

-- -----------------------------------------------------------------------------
-- Demo store "Stocktill Demo Electronics": catalog, customers, stock and 60 days
-- of sales and returns. Built by public.reset_demo_store() (migration
-- 20261106184014_demo.sql), the same function that rebuilds the public demo in
-- production every night. It finds the demo users by app_metadata.demo_role.
-- p_lock => false: locally the demo store is the dev/test fixture, so its team
-- and settings stay editable (tests change them).
-- -----------------------------------------------------------------------------
select public.reset_demo_store(p_password => null, p_lock => false);

-- -----------------------------------------------------------------------------
-- "Other Shop" (EUR, tax added on top): only for isolation checks.
-- Subscription trialing, 10 days left (no Stripe involved).
-- To try real Stripe Checkout, sign up a new owner and store (see docs/STRIPE.md).
-- -----------------------------------------------------------------------------
insert into public.stores (id, name, slug, currency, tax_rate, prices_include_tax, timezone, ticket_footer, created_by)
values ('b0000000-0000-4000-8000-000000000002', 'Other Shop', 'other-shop',
        'EUR', 0.2100, false, 'Europe/Madrid', null,
        'a0000000-0000-4000-8000-000000000004');

insert into public.store_members (store_id, user_id, role)
values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', 'owner');

insert into public.subscriptions (store_id, stripe_customer_id, status, trial_end, current_period_end)
values ('b0000000-0000-4000-8000-000000000002', null, 'trialing', now() + interval '10 days', now() + interval '10 days');

insert into public.products (id, store_id, sku, barcode, name, category, sale_price, low_stock_threshold, created_by)
values
  ('c0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000002', 'OTH-001', '2000000000213', 'Phone Stand',       'Accessories',  7.50, 2, 'a0000000-0000-4000-8000-000000000004'),
  ('c0000000-0000-4000-8000-000000000102', 'b0000000-0000-4000-8000-000000000002', 'OTH-002', '2000000000220', 'Laptop Sleeve 14"', 'Accessories', 24.00, 2, 'a0000000-0000-4000-8000-000000000004');

-- Acting as a user: request.jwt.claims is what PostgREST sets from a verified
-- JWT; here the seed (running as postgres, locally) sets it so auth.uid()
-- returns that user. No keys or tokens are involved.
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', false);

select public.create_stock_entry(
  'b0000000-0000-4000-8000-000000000002',
  '[{"product_id":"c0000000-0000-4000-8000-000000000101","quantity":10,"unit_cost":2.00},
    {"product_id":"c0000000-0000-4000-8000-000000000102","quantity":5,"unit_cost":9.00}]',
  null,
  'Opening stock'
);

-- Back to "no user".
select set_config('request.jwt.claims', '', false);
