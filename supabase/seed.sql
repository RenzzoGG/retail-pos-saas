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
   'USD', 0.0825, true, 'America/New_York', 'Thanks for shopping with us!',
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

-- Subscriptions (no Stripe involved; written here as the seed, like the webhook would):
--   Demo store: active, complimentary plan (no Stripe customer) — full access.
--   Other Shop: trialing, 10 days left.
-- To try real Stripe Checkout, sign up a new owner and store (see docs/STRIPE.md).
insert into public.subscriptions (store_id, stripe_customer_id, status, trial_end, current_period_end)
values
  ('b0000000-0000-4000-8000-000000000001', null, 'active', null, now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000002', null, 'trialing', now() + interval '10 days', now() + interval '10 days');

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

-- Customers of the demo store.
insert into public.customers (id, store_id, name, document_id, phone, email, created_by)
values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Jordan Rivera', 'ID-1001', '+1 555 0101', 'jordan.rivera@example.com', 'a0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Sam Taylor',    'ID-1002', '+1 555 0102', 'sam.taylor@example.com',    'a0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Alex Morgan',   null,      '+1 555 0103', null,                        'a0000000-0000-4000-8000-000000000001');

-- -----------------------------------------------------------------------------
-- Acting as a user: request.jwt.claims is what PostgREST sets from a verified
-- JWT; here the seed (running as postgres, locally) sets it so auth.uid()
-- returns that user. No keys or tokens are involved.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 60 days of demo history (dashboard and reports). Deterministic: setseed().
--
--  1. Plan the sales first (3-9 a day, more on weekends, opening hours, mixed
--     cashiers, customers, discounts within the cashier limit, cash / card /
--     transfer / split payments) and ~12 returns, 1 in 4 of them a write-off.
--  2. Opening stock = today's demo stock + units planned to be sold − units
--     that will come back to stock. So the stock you see today is the same as
--     before this history existed (low-stock products stay low).
--  3. Replay everything in time order through create_sale / create_return, as
--     the real users, so the ledger stays consistent (stock = Σ movements).
--  4. Move the timestamps into the past. Only the seed does this, locally: it
--     briefly disables the user triggers of the affected tables (the activity
--     log is append-only for everyone else) and re-enables them right after.
-- -----------------------------------------------------------------------------
create temporary table seed_plan (
  seq serial primary key,
  at timestamptz not null,
  actor uuid not null,
  customer uuid,
  items jsonb not null,
  sale_discount numeric not null,
  payments jsonb not null,
  ret_at timestamptz,
  ret_restock boolean,
  sale_id uuid
);

do $$
declare
  v_store constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_tz constant text := 'America/New_York';
  v_today date := (now() at time zone v_tz)::date;
  v_customers uuid[] := array['d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002',
                              'd0000000-0000-4000-8000-000000000003']::uuid[];
  v_pool uuid[];
  v_day date;
  v_n integer;
  v_at timestamptz;
  v_k integer;
  v_chosen uuid[];
  v_items jsonb;
  v_product uuid;
  v_price numeric;
  v_qty integer;
  v_disc numeric;
  v_gross numeric;
  v_sale_disc numeric;
  v_total numeric;
  v_r double precision;
  v_payments jsonb;
  v_card numeric;
begin
  perform setseed(0.42);
  -- Cheaper items sell more often.
  select array_agg(p.id order by p.sku, g)
    into v_pool
  from seed_products p,
       generate_series(1, case when p.sale_price < 15 then 6 when p.sale_price < 25 then 4
                               when p.sale_price < 45 then 2 else 1 end) g
  where p.store_id = v_store;

  for v_d in reverse 60..0 loop
    v_day := v_today - v_d;
    v_n := 3 + floor(random() * 5)::integer + case when extract(isodow from v_day) in (6, 7) then 2 else 0 end;
    for v_i in 1..v_n loop
      v_at := (v_day + time '09:00' + random() * interval '11 hours') at time zone v_tz;
      continue when v_at > now() - interval '10 minutes'; -- today: only what already happened

      v_k := 1 + floor(random() * random() * 3.5)::integer;
      v_chosen := '{}';
      v_items := '[]';
      v_gross := 0;
      for v_j in 1..v_k loop
        v_product := v_pool[1 + floor(random() * array_length(v_pool, 1))::integer];
        continue when v_product = any (v_chosen);
        v_chosen := v_chosen || v_product;
        select sale_price into v_price from seed_products where id = v_product;
        v_qty := case when v_price < 15 and random() < 0.35 then 2 else 1 end;
        v_disc := case when v_j = 1 and random() < 0.15 then round(v_price * v_qty * 0.05, 2) else 0 end;
        v_items := v_items || jsonb_build_object('product_id', v_product, 'quantity', v_qty, 'discount', v_disc);
        v_gross := v_gross + v_price * v_qty - v_disc;
      end loop;
      -- Line 5 % + sale 5 % stays within the cashier's 10 % limit.
      v_sale_disc := case when random() < 0.10 then round(v_gross * 0.05, 2) else 0 end;
      v_total := v_gross - v_sale_disc; -- prices include tax

      v_r := random();
      if v_r < 0.45 then
        v_payments := jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', v_total,
                        'tendered', ceil(v_total / 5) * 5));
      elsif v_r < 0.85 then
        v_payments := jsonb_build_array(jsonb_build_object('method', 'card', 'amount', v_total));
      elsif v_r < 0.93 then
        v_payments := jsonb_build_array(jsonb_build_object('method', 'transfer', 'amount', v_total));
      else
        v_card := floor(v_total / 2);
        v_payments := jsonb_build_array(
          jsonb_build_object('method', 'card', 'amount', v_card),
          jsonb_build_object('method', 'cash', 'amount', v_total - v_card, 'tendered', ceil(v_total - v_card)));
      end if;

      v_r := random();
      insert into seed_plan (at, actor, customer, items, sale_discount, payments)
      values (
        v_at,
        case when v_r < 0.6 then 'a0000000-0000-4000-8000-000000000003'::uuid
             when v_r < 0.85 then 'a0000000-0000-4000-8000-000000000002'::uuid
             else 'a0000000-0000-4000-8000-000000000001'::uuid end,
        case when random() < 0.3 then v_customers[1 + floor(random() * 3)::integer] end,
        v_items, v_sale_disc, v_payments);
    end loop;
  end loop;

  -- ~12 returns of the first line (1 unit), 1-3 days after the sale; every 4th is damaged.
  with ranked as (
    select seq, at, row_number() over (order by at) as rn
    from seed_plan where at < now() - interval '4 days'
  )
  update seed_plan p
     set ret_at = r.at + (1 + r.rn % 3) * interval '1 day' + interval '3 hours',
         ret_restock = (r.rn / 30) % 4 <> 1
    from ranked r
   where p.seq = r.seq and r.rn % 30 = 7;
end;
$$;

-- Opening stock, as the owner.
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

select public.create_stock_entry(
  'b0000000-0000-4000-8000-000000000001',
  (select jsonb_agg(jsonb_build_object('product_id', p.id, 'quantity', p.initial_qty + coalesce(x.sold, 0) - coalesce(x.back, 0),
                                       'unit_cost', p.unit_cost))
   from seed_products p
   left join (
     select (i ->> 'product_id')::uuid as product_id,
            sum((i ->> 'quantity')::integer) as sold,
            sum(case when sp.ret_restock and i.ord = 1 then 1 else 0 end) as back
     from seed_plan sp, jsonb_array_elements(sp.items) with ordinality i(i, ord)
     group by 1
   ) x on x.product_id = p.id
   where p.store_id = 'b0000000-0000-4000-8000-000000000001'),
  'Demo Distributor Inc.',
  'Opening stock'
);

-- Replay sales and returns in time order, each as its user.
do $$
declare
  v_event record;
  v_sale_id uuid;
  v_item uuid;
begin
  for v_event in
    select at, 'sale' as kind, seq from seed_plan
    union all
    select ret_at, 'return', seq from seed_plan where ret_at is not null
    order by 1
  loop
    if v_event.kind = 'sale' then
      perform set_config('request.jwt.claims',
        json_build_object('sub', (select actor from seed_plan where seq = v_event.seq), 'role', 'authenticated')::text, false);
      select public.create_sale('b0000000-0000-4000-8000-000000000001', p.items, p.payments, gen_random_uuid(),
                                p.customer, p.sale_discount)
        into v_sale_id
      from seed_plan p where p.seq = v_event.seq;
      update seed_plan set sale_id = v_sale_id where seq = v_event.seq;
    else
      perform set_config('request.jwt.claims',
        '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false); -- the admin
      select si.id into v_item
      from seed_plan p
      join public.sale_items si on si.sale_id = p.sale_id and si.product_id = (p.items -> 0 ->> 'product_id')::uuid
      where p.seq = v_event.seq;
      perform public.create_return(
        p.sale_id,
        jsonb_build_array(jsonb_build_object('sale_item_id', v_item, 'quantity', 1, 'restock', p.ret_restock)),
        case when p.ret_restock then 'Changed their mind' else 'Damaged, written off' end,
        case when p.payments -> 0 ->> 'method' = 'transfer' then 'transfer'::public.payment_method
             when p.payments -> 0 ->> 'method' = 'card' then 'card'::public.payment_method
             else 'cash'::public.payment_method end)
      from seed_plan p where p.seq = v_event.seq;
    end if;
  end loop;
end;
$$;

-- Move it all into the past (local seed only; triggers re-enabled right after).
alter table public.activity_log disable trigger user;
alter table public.sales disable trigger user;
alter table public.returns disable trigger user;
alter table public.products disable trigger user;
alter table public.customers disable trigger user;
alter table public.stock_entries disable trigger user;

do $$
declare
  v_store constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_open timestamptz := ((now() at time zone 'America/New_York')::date - 61 + time '08:00') at time zone 'America/New_York';
begin
  -- Catalog, customers and the opening stock entry: 61 days ago.
  update public.products set created_at = v_open, updated_at = v_open where store_id = v_store;
  update public.customers set created_at = v_open, updated_at = v_open where store_id = v_store;
  update public.stock_entries set created_at = v_open where store_id = v_store;
  update public.stock_movements set created_at = v_open where store_id = v_store and type = 'entry';
  update public.activity_log set created_at = v_open where store_id = v_store;

  -- Sales: the sale, its payments, its stock movements and its log row.
  update public.sales s set created_at = p.at from seed_plan p where s.id = p.sale_id;
  update public.sale_payments sp set created_at = p.at from seed_plan p where sp.sale_id = p.sale_id;
  update public.stock_movements m set created_at = p.at
    from seed_plan p join public.sale_items si on si.sale_id = p.sale_id
   where m.ref_id = si.id;
  update public.activity_log a
     set created_at = p.at, after = jsonb_set(a.after, '{created_at}', to_jsonb(p.at))
    from seed_plan p
   where a.table_name = 'sales' and a.action = 'insert' and a.record_id = p.sale_id::text;

  -- Returns: the return, its movements, its log row and the sale's status change.
  update public.returns r set created_at = p.ret_at from seed_plan p where r.sale_id = p.sale_id and p.ret_at is not null;
  update public.stock_movements m set created_at = r.created_at
    from public.returns r join public.return_items ri on ri.return_id = r.id
   where m.ref_id = ri.id and r.store_id = v_store;
  update public.activity_log a
     set created_at = r.created_at, after = jsonb_set(a.after, '{created_at}', to_jsonb(r.created_at))
    from public.returns r
   where a.table_name = 'returns' and a.record_id = r.id::text;
  update public.activity_log a
     set created_at = p.ret_at,
         before = jsonb_set(a.before, '{created_at}', to_jsonb(p.at)),
         after = jsonb_set(a.after, '{created_at}', to_jsonb(p.at))
    from seed_plan p
   where a.table_name = 'sales' and a.action = 'update' and a.record_id = p.sale_id::text;
end;
$$;

alter table public.activity_log enable trigger user;
alter table public.sales enable trigger user;
alter table public.returns enable trigger user;
alter table public.products enable trigger user;
alter table public.customers enable trigger user;
alter table public.stock_entries enable trigger user;

drop table seed_plan;

-- Two more demo sales today, made by the cashier (the latest sale numbers).
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
