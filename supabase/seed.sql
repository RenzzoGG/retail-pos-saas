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
-- through create_sale(), so the ledger is consistent (stock = sum of movements).
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
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name), now(), now(),
  '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'owner@demo.stocktill.test',   'Olivia Owner'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'admin@demo.stocktill.test',   'Adam Admin'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'cashier@demo.stocktill.test', 'Carla Cashier'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'owner@other.stocktill.test',  'Oscar Other')
) as u(id, email, full_name);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email like '%.stocktill.test';

-- -----------------------------------------------------------------------------
-- Stores and memberships
-- -----------------------------------------------------------------------------
insert into public.stores (id, name, slug, currency, tax_rate, prices_include_tax, timezone, ticket_footer, created_by)
values
  ('b0000000-0000-4000-8000-000000000001', 'Stocktill Demo Electronics', 'demo-electronics',
   'USD', 0.0825, true, 'America/New_York', 'Thanks for shopping with us! Returns within 30 days with this ticket.',
   'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'Other Shop', 'other-shop',
   'EUR', 0.2100, false, 'Europe/Madrid', null,
   'a0000000-0000-4000-8000-000000000004');

insert into public.store_members (store_id, user_id, role)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'admin'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'cashier'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', 'owner');

-- -----------------------------------------------------------------------------
-- Products (stock starts at 0; it is loaded below with a stock entry).
-- Demo store prices are in USD and include tax.
-- -----------------------------------------------------------------------------
create temporary table seed_products (
  id uuid, store_id uuid, sku text, barcode text, name text, category text,
  sale_price numeric, low_stock_threshold integer, initial_qty integer, unit_cost numeric
);

insert into seed_products values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'CBL-USBC-1M',  '2000000000015', 'USB-C to USB-C Cable 1 m',          'Cables',     9.99,  10, 60, 3.20),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'CBL-USBC-2M',  '2000000000022', 'USB-C to USB-C Cable 2 m',          'Cables',    12.99,  10, 40, 4.10),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'CBL-LTN-1M',   '2000000000039', 'USB-C to Lightning Cable 1 m',      'Cables',    14.99,   8, 35, 4.80),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'CBL-HDMI-2M',  '2000000000046', 'HDMI 2.1 Cable 2 m',                'Cables',    16.99,   5, 20, 5.50),
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'CHG-20W-C',    '2000000000053', '20 W USB-C Wall Charger',           'Chargers',  19.99,   8, 30, 7.40),
  ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'CHG-65W-GAN',  '2000000000060', '65 W GaN Charger (2 ports)',        'Chargers',  44.99,   4, 12, 21.00),
  ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001', 'CHG-CAR-2P',   '2000000000077', 'Dual-Port Car Charger',             'Chargers',  17.99,   5, 18, 6.30),
  ('c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001', 'CHG-WL-15W',   '2000000000084', '15 W Wireless Charging Pad',        'Chargers',  29.99,   4, 10, 11.50),
  ('c0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000001', 'PWB-10K',      '2000000000091', 'Power Bank 10,000 mAh',             'Power',     34.99,   5, 15, 14.20),
  ('c0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000001', 'PWB-20K',      '2000000000107', 'Power Bank 20,000 mAh',             'Power',     49.99,   3,  3, 22.80),
  ('c0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001', 'AUD-EARBUD-W', '2000000000114', 'True Wireless Earbuds',             'Audio',     59.99,   4, 14, 26.00),
  ('c0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000001', 'AUD-HEAD-BT',  '2000000000121', 'Over-Ear Bluetooth Headphones',     'Audio',     79.99,   2,  6, 38.50),
  ('c0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001', 'AUD-WIRED-35', '2000000000138', 'Wired Earphones 3.5 mm',            'Audio',      8.99,  10, 50, 2.40),
  ('c0000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000001', 'AUD-SPK-MINI', '2000000000145', 'Mini Bluetooth Speaker',            'Audio',     39.99,   3,  8, 17.00),
  ('c0000000-0000-4000-8000-000000000015', 'b0000000-0000-4000-8000-000000000001', 'CAS-IP15-CLR', '2000000000152', 'Clear Case for iPhone 15',          'Cases',     15.99,   6, 25, 3.90),
  ('c0000000-0000-4000-8000-000000000016', 'b0000000-0000-4000-8000-000000000001', 'CAS-GS24-BLK', '2000000000169', 'Rugged Case for Galaxy S24',        'Cases',     19.99,   6,  4, 5.20),
  ('c0000000-0000-4000-8000-000000000017', 'b0000000-0000-4000-8000-000000000001', 'SCR-TMP-IP15', '2000000000176', 'Tempered Glass Screen Protector',   'Cases',      9.99,  15, 70, 1.60),
  ('c0000000-0000-4000-8000-000000000018', 'b0000000-0000-4000-8000-000000000001', 'ACC-MOUSE-WL', '2000000000183', 'Wireless Mouse',                    'Computer',  24.99,   4, 16, 9.80),
  ('c0000000-0000-4000-8000-000000000019', 'b0000000-0000-4000-8000-000000000001', 'ACC-HUB-7IN1', '2000000000190', 'USB-C 7-in-1 Hub',                  'Computer',  54.99,   2,  2, 27.00),
  ('c0000000-0000-4000-8000-000000000020', 'b0000000-0000-4000-8000-000000000001', 'ACC-SD-128',   '2000000000206', 'microSD Card 128 GB',               'Storage',   21.99,   6, 22, 9.10),
  -- Other Shop (EUR, tax added on top): only for isolation checks.
  ('c0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000002', 'OTH-001',      '2000000000213', 'Phone Stand',                       'Accessories', 7.50,  2, 10, 2.00),
  ('c0000000-0000-4000-8000-000000000102', 'b0000000-0000-4000-8000-000000000002', 'OTH-002',      '2000000000220', 'Laptop Sleeve 14"',                 'Accessories', 24.00, 2,  5, 9.00);

insert into public.products (id, store_id, sku, barcode, name, category, sale_price, low_stock_threshold, created_by)
select p.id, p.store_id, p.sku, p.barcode, p.name, p.category, p.sale_price, p.low_stock_threshold,
       case p.store_id
         when 'b0000000-0000-4000-8000-000000000001' then 'a0000000-0000-4000-8000-000000000001'::uuid
         else 'a0000000-0000-4000-8000-000000000004'::uuid
       end
from seed_products p;

-- -----------------------------------------------------------------------------
-- Opening stock: one stock entry per store, made "as" each store's owner.
-- request.jwt.claims is what PostgREST sets from a verified JWT; here the seed
-- (running as postgres, locally) sets it so auth.uid() returns the owner.
-- No keys or tokens are involved.
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

select public.create_stock_entry(
  'b0000000-0000-4000-8000-000000000001',
  (select jsonb_agg(jsonb_build_object('product_id', id, 'quantity', initial_qty, 'unit_cost', unit_cost))
   from seed_products where store_id = 'b0000000-0000-4000-8000-000000000001'),
  'Demo Distributor Inc.',
  'Opening stock'
);

-- Customers of the demo store.
insert into public.customers (id, store_id, name, document_id, phone, email, created_by)
values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Jordan Rivera', 'ID-1001', '+1 555 0101', 'jordan.rivera@example.com', 'a0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Sam Taylor',    'ID-1002', '+1 555 0102', 'sam.taylor@example.com',    'a0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Alex Morgan',   null,      '+1 555 0103', null,                        'a0000000-0000-4000-8000-000000000001');

-- Two demo sales made by the cashier.
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

-- Sale 1: 2 cables + 1 charger = 2*9.99 + 19.99 = 39.97, paid cash (50.00 tendered).
select public.create_sale(
  'b0000000-0000-4000-8000-000000000001',
  '[{"product_id":"c0000000-0000-4000-8000-000000000001","quantity":2},
    {"product_id":"c0000000-0000-4000-8000-000000000005","quantity":1}]',
  '[{"method":"cash","amount":39.97,"tendered":50.00}]',
  'e0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001'
);

-- Sale 2: earbuds with a 5.00 line discount = 54.99, paid by card.
select public.create_sale(
  'b0000000-0000-4000-8000-000000000001',
  '[{"product_id":"c0000000-0000-4000-8000-000000000011","quantity":1,"discount":5.00}]',
  '[{"method":"card","amount":54.99}]',
  'e0000000-0000-4000-8000-000000000002'
);

-- Other Shop opening stock, as its owner.
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', false);

select public.create_stock_entry(
  'b0000000-0000-4000-8000-000000000002',
  (select jsonb_agg(jsonb_build_object('product_id', id, 'quantity', initial_qty, 'unit_cost', unit_cost))
   from seed_products where store_id = 'b0000000-0000-4000-8000-000000000002'),
  null,
  'Opening stock'
);

-- Back to "no user".
select set_config('request.jwt.claims', '', false);
drop table seed_products;
