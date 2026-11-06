-- =============================================================================
-- Phase 11: public portfolio demo.
--
-- Visitors sign in with published demo accounts (owner / admin / cashier of
-- "Stocktill Demo Electronics") and can use the whole POS. To keep the demo
-- usable for the next visitor:
--
--   1. public.reset_demo_store() rebuilds the demo store from scratch
--      (catalog, customers, 60 days of history) and restores the demo users'
--      email, password and roles. Production runs it nightly with pg_cron.
--      Only service_role / postgres can execute it.
--   2. Stores flagged is_demo lock what could break the demo for others or
--      be abused: team changes and invitations (they send email), store
--      settings, and creating new stores from a demo account.
--      Enforced here with triggers; the app shows clear messages.
--
-- Demo users are found by raw_app_meta_data.demo_role (set by the local seed
-- or by scripts/demo-provision.mjs through the Admin API). Users can't change
-- app_metadata, so a visitor who changes the email can't hide the account.
--
-- Locally the seed calls reset_demo_store(p_lock => false): the demo store is
-- the development/test fixture and the tests change its team and settings.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
create function app.is_demo_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.is_demo from public.stores s where s.id = p_store_id), false);
$$;

-- The signed-in user belongs to a locked demo store.
create function app.is_demo_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members m
    join public.stores s on s.id = m.store_id
    where m.user_id = (select auth.uid()) and s.is_demo
  );
$$;

create function app.guard_demo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record := coalesce(new, old);
begin
  -- Only signed-in users: the reset function, the seed and migrations are not users.
  if (select auth.uid()) is null then
    return v_row;
  end if;

  if tg_table_name = 'stores' then
    if tg_op = 'INSERT' and app.is_demo_user() then
      raise exception 'demo_locked' using errcode = '42501', hint = 'create_store';
    elsif tg_op = 'DELETE' and old.is_demo then
      raise exception 'demo_locked' using errcode = '42501', hint = 'store_settings';
    elsif tg_op = 'UPDATE' and old.is_demo
      -- Only the settings users edit: create_sale bumps last_sale_number.
      and (old.name, old.currency, old.tax_rate, old.prices_include_tax, old.ticket_footer, old.timezone,
           old.max_cashier_discount_pct, old.is_demo)
          is distinct from
          (new.name, new.currency, new.tax_rate, new.prices_include_tax, new.ticket_footer, new.timezone,
           new.max_cashier_discount_pct, new.is_demo) then
      raise exception 'demo_locked' using errcode = '42501', hint = 'store_settings';
    end if;
  elsif tg_table_name = 'invitations' then
    if tg_op = 'INSERT' and (app.is_demo_store(new.store_id) or app.is_demo_user()) then
      raise exception 'demo_locked' using errcode = '42501', hint = 'invitations';
    end if;
  elsif tg_table_name = 'store_members' then
    if app.is_demo_store(v_row.store_id) then
      raise exception 'demo_locked' using errcode = '42501', hint = 'team';
    end if;
  elsif tg_table_name = 'profiles' then
    if tg_op = 'UPDATE' and app.is_demo_user() then
      raise exception 'demo_locked' using errcode = '42501', hint = 'profile';
    end if;
  end if;
  return v_row;
end;
$$;

create trigger stores_demo_guard before insert or update or delete on public.stores
  for each row execute function app.guard_demo();
create trigger invitations_demo_guard before insert on public.invitations
  for each row execute function app.guard_demo();
create trigger store_members_demo_guard before insert or update or delete on public.store_members
  for each row execute function app.guard_demo();
create trigger profiles_demo_guard before update on public.profiles
  for each row execute function app.guard_demo();

-- -----------------------------------------------------------------------------
-- Demo data used by the reset (schema app: not exposed through the API).
-- -----------------------------------------------------------------------------
-- Catalog of the demo store: 20 electronics accessories (EAN-13 codes use the
-- GS1 "200" in-store prefix). initial_qty is the stock you see today.
create table app.demo_products (
  id uuid primary key,
  sku text not null,
  barcode text not null,
  name text not null,
  category text not null,
  sale_price numeric(12, 2) not null,
  low_stock_threshold integer not null,
  initial_qty integer not null,
  unit_cost numeric(12, 2) not null
);

insert into app.demo_products values
  ('c0000000-0000-4000-8000-000000000001', 'CBL-USBC-1M',  '2000000000015', 'USB-C to USB-C Cable 1 m',        'Cables',    9.99,  10, 60, 3.20),
  ('c0000000-0000-4000-8000-000000000002', 'CBL-USBC-2M',  '2000000000022', 'USB-C to USB-C Cable 2 m',        'Cables',   12.99,  10, 40, 4.10),
  ('c0000000-0000-4000-8000-000000000003', 'CBL-LTN-1M',   '2000000000039', 'USB-C to Lightning Cable 1 m',    'Cables',   14.99,   8, 35, 4.80),
  ('c0000000-0000-4000-8000-000000000004', 'CBL-HDMI-2M',  '2000000000046', 'HDMI 2.1 Cable 2 m',              'Cables',   16.99,   5, 20, 5.50),
  ('c0000000-0000-4000-8000-000000000005', 'CHG-20W-C',    '2000000000053', '20 W USB-C Wall Charger',         'Chargers', 19.99,   8, 30, 7.40),
  ('c0000000-0000-4000-8000-000000000006', 'CHG-65W-GAN',  '2000000000060', '65 W GaN Charger (2 ports)',      'Chargers', 44.99,   4, 12, 21.00),
  ('c0000000-0000-4000-8000-000000000007', 'CHG-CAR-2P',   '2000000000077', 'Dual-Port Car Charger',           'Chargers', 17.99,   5, 18, 6.30),
  ('c0000000-0000-4000-8000-000000000008', 'CHG-WL-15W',   '2000000000084', '15 W Wireless Charging Pad',      'Chargers', 29.99,   4, 10, 11.50),
  ('c0000000-0000-4000-8000-000000000009', 'PWB-10K',      '2000000000091', 'Power Bank 10,000 mAh',           'Power',    34.99,   5, 15, 14.20),
  ('c0000000-0000-4000-8000-000000000010', 'PWB-20K',      '2000000000107', 'Power Bank 20,000 mAh',           'Power',    49.99,   3,  3, 22.80),
  ('c0000000-0000-4000-8000-000000000011', 'AUD-EARBUD-W', '2000000000114', 'True Wireless Earbuds',           'Audio',    59.99,   4, 14, 26.00),
  ('c0000000-0000-4000-8000-000000000012', 'AUD-HEAD-BT',  '2000000000121', 'Over-Ear Bluetooth Headphones',   'Audio',    79.99,   2,  6, 38.50),
  ('c0000000-0000-4000-8000-000000000013', 'AUD-WIRED-35', '2000000000138', 'Wired Earphones 3.5 mm',          'Audio',     8.99,  10, 50, 2.40),
  ('c0000000-0000-4000-8000-000000000014', 'AUD-SPK-MINI', '2000000000145', 'Mini Bluetooth Speaker',          'Audio',    39.99,   3,  8, 17.00),
  ('c0000000-0000-4000-8000-000000000015', 'CAS-IP15-CLR', '2000000000152', 'Clear Case for iPhone 15',        'Cases',    15.99,   6, 25, 3.90),
  ('c0000000-0000-4000-8000-000000000016', 'CAS-GS24-BLK', '2000000000169', 'Rugged Case for Galaxy S24',      'Cases',    19.99,   6,  4, 5.20),
  ('c0000000-0000-4000-8000-000000000017', 'SCR-TMP-IP15', '2000000000176', 'Tempered Glass Screen Protector', 'Cases',     9.99,  15, 70, 1.60),
  ('c0000000-0000-4000-8000-000000000018', 'ACC-MOUSE-WL', '2000000000183', 'Wireless Mouse',                  'Computer', 24.99,   4, 16, 9.80),
  ('c0000000-0000-4000-8000-000000000019', 'ACC-HUB-7IN1', '2000000000190', 'USB-C 7-in-1 Hub',                'Computer', 54.99,   2,  2, 27.00),
  ('c0000000-0000-4000-8000-000000000020', 'ACC-SD-128',   '2000000000206', 'microSD Card 128 GB',             'Storage',  21.99,   6, 22, 9.10);

-- Working table of the reset: the planned sales and returns (emptied each run).
create table app.demo_plan (
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

revoke all on app.demo_products, app.demo_plan from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Reset
-- -----------------------------------------------------------------------------
create function public.reset_demo_store(p_password text default null, p_lock boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set client_min_messages = warning
as $$
declare
  v_store constant uuid := 'b0000000-0000-4000-8000-000000000001'::uuid;
  v_tz constant text := 'America/New_York';
  v_claims constant text := current_setting('request.jwt.claims', true);
  v_owner uuid;
  v_admin uuid;
  v_cashier uuid;
  v_today date;
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
  v_event record;
  v_sale_id uuid;
  v_item uuid;
  v_open timestamptz;
  v_sales integer;
  v_returns integer;
  v_credentials text := 'skipped';
begin
  -- One reset at a time (they share app.demo_plan).
  perform pg_advisory_xact_lock(hashtext('public.reset_demo_store'));

  -- ---------------------------------------------------------------- users
  select id into v_owner from auth.users where raw_app_meta_data ->> 'demo_role' = 'owner' order by created_at limit 1;
  select id into v_admin from auth.users where raw_app_meta_data ->> 'demo_role' = 'admin' order by created_at limit 1;
  select id into v_cashier from auth.users where raw_app_meta_data ->> 'demo_role' = 'cashier' order by created_at limit 1;
  if v_owner is null or v_admin is null or v_cashier is null then
    raise exception 'demo_users_missing'
      using hint = 'Create the demo users first (scripts/demo-provision.mjs or the local seed).';
  end if;

  -- Undo what a visitor could have changed through the Auth API directly
  -- (email, password). Best effort: if this database role may not write
  -- auth.users, the data reset still runs.
  begin
    update auth.users u
       set email = d.email,
           email_change = '',
           email_change_token_new = '',
           email_change_token_current = '',
           email_confirmed_at = coalesce(u.email_confirmed_at, now()),
           banned_until = null,
           encrypted_password = case when p_password is null then u.encrypted_password
                                     else extensions.crypt(p_password, extensions.gen_salt('bf')) end,
           raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', d.full_name)
      from (values (v_owner, 'owner@demo.stocktill.test', 'Olivia Owner'),
                   (v_admin, 'admin@demo.stocktill.test', 'Adam Admin'),
                   (v_cashier, 'cashier@demo.stocktill.test', 'Carla Cashier')) as d(id, email, full_name)
     where u.id = d.id;
    v_credentials := case when p_password is null then 'email' else 'email+password' end;
  exception when insufficient_privilege then
    raise warning 'reset_demo_store: could not restore demo credentials (%)', sqlerrm;
  end;

  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------- wipe
  -- User triggers off: the activity log is append-only, the audit triggers
  -- would log every delete and the guards would refuse them.
  alter table public.activity_log disable trigger user;
  alter table public.stores disable trigger user;
  alter table public.store_members disable trigger user;
  alter table public.invitations disable trigger user;
  alter table public.sales disable trigger user;
  alter table public.returns disable trigger user;
  alter table public.products disable trigger user;
  alter table public.product_costs disable trigger user;
  alter table public.customers disable trigger user;
  alter table public.stock_entries disable trigger user;
  alter table public.import_batches disable trigger user;
  alter table public.profiles disable trigger user;

  delete from public.returns where store_id = v_store;
  delete from public.stock_movements where store_id = v_store;
  delete from public.sales where store_id = v_store;
  delete from public.import_batches where store_id = v_store;
  delete from public.stock_entries where store_id = v_store;
  delete from public.products where store_id = v_store;
  delete from public.customers where store_id = v_store;
  delete from public.activity_log where store_id = v_store;
  delete from public.stores where id = v_store; -- cascades: members, invitations, subscription

  update public.profiles p
     set full_name = d.full_name
    from (values (v_owner, 'Olivia Owner'), (v_admin, 'Adam Admin'), (v_cashier, 'Carla Cashier')) as d(id, full_name)
   where p.id = d.id;

  alter table public.activity_log enable trigger user;
  alter table public.stores enable trigger user;
  alter table public.store_members enable trigger user;
  alter table public.invitations enable trigger user;
  alter table public.sales enable trigger user;
  alter table public.returns enable trigger user;
  alter table public.products enable trigger user;
  alter table public.product_costs enable trigger user;
  alter table public.customers enable trigger user;
  alter table public.stock_entries enable trigger user;
  alter table public.import_batches enable trigger user;
  alter table public.profiles enable trigger user;

  -- ---------------------------------------------------------------- store
  insert into public.stores (id, name, slug, currency, tax_rate, prices_include_tax, timezone, ticket_footer, created_by)
  values (v_store, 'Stocktill Demo Electronics', 'demo-electronics', 'USD', 0.0825, true, v_tz,
          'Thanks for shopping with us!', v_owner);

  insert into public.store_members (store_id, user_id, role)
  values (v_store, v_owner, 'owner'), (v_store, v_admin, 'admin'), (v_store, v_cashier, 'cashier');

  -- Complimentary plan, not linked to Stripe: full access, nothing to pay.
  insert into public.subscriptions (store_id, stripe_customer_id, status, trial_end, current_period_end)
  values (v_store, null, 'active', null, now() + interval '30 days');

  -- ---------------------------------------------------------------- catalog

  insert into public.products (id, store_id, sku, barcode, name, category, sale_price, low_stock_threshold, created_by)
  select p.id, v_store, p.sku, p.barcode, p.name, p.category, p.sale_price, p.low_stock_threshold, v_owner
  from app.demo_products p;

  insert into public.customers (id, store_id, name, document_id, phone, email, created_by)
  values
    (v_customers[1], v_store, 'Jordan Rivera', 'ID-1001', '+1 555 0101', 'jordan.rivera@example.com', v_owner),
    (v_customers[2], v_store, 'Sam Taylor',    'ID-1002', '+1 555 0102', 'sam.taylor@example.com',    v_owner),
    (v_customers[3], v_store, 'Alex Morgan',   null,      '+1 555 0103', null,                        v_owner);

  -- ---------------------------------------------------------------- history
  -- 60 days, deterministic (setseed):
  --  1. Plan the sales (3-9 a day, more on weekends, opening hours, mixed
  --     cashiers, customers, discounts within the cashier limit, cash / card /
  --     transfer / split payments) and ~12 returns, 1 in 4 of them a write-off.
  --  2. Opening stock = today's demo stock + units to be sold − units that will
  --     come back, so low-stock products stay low.
  --  3. Replay in time order through create_sale / create_return, as the real
  --     users, so the ledger stays consistent (stock = Σ movements).
  --  4. Move the timestamps into the past (user triggers briefly disabled).
  truncate app.demo_plan restart identity;

  v_today := (now() at time zone v_tz)::date;
  perform setseed(0.42);
  -- Cheaper items sell more often.
  select array_agg(p.id order by p.sku, g)
    into v_pool
  from app.demo_products p,
       generate_series(1, case when p.sale_price < 15 then 6 when p.sale_price < 25 then 4
                               when p.sale_price < 45 then 2 else 1 end) g;

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
        select sale_price into v_price from app.demo_products where id = v_product;
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
      insert into app.demo_plan (at, actor, customer, items, sale_discount, payments)
      values (
        v_at,
        case when v_r < 0.6 then v_cashier when v_r < 0.85 then v_admin else v_owner end,
        case when random() < 0.3 then v_customers[1 + floor(random() * 3)::integer] end,
        v_items, v_sale_disc, v_payments);
    end loop;
  end loop;

  -- ~12 returns of the first line (1 unit), 1-3 days after the sale; every 4th is damaged.
  with ranked as (
    select seq, at, row_number() over (order by at) as rn
    from app.demo_plan where at < now() - interval '4 days'
  )
  update app.demo_plan p
     set ret_at = r.at + (1 + r.rn % 3) * interval '1 day' + interval '3 hours',
         ret_restock = (r.rn / 30) % 4 <> 1
    from ranked r
   where p.seq = r.seq and r.rn % 30 = 7;

  -- Opening stock, as the owner.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.create_stock_entry(
    v_store,
    (select jsonb_agg(jsonb_build_object('product_id', p.id, 'quantity', p.initial_qty + coalesce(x.sold, 0) - coalesce(x.back, 0),
                                         'unit_cost', p.unit_cost))
     from app.demo_products p
     left join (
       select (i ->> 'product_id')::uuid as product_id,
              sum((i ->> 'quantity')::integer) as sold,
              sum(case when sp.ret_restock and i.ord = 1 then 1 else 0 end) as back
       from app.demo_plan sp, jsonb_array_elements(sp.items) with ordinality i(i, ord)
       group by 1
     ) x on x.product_id = p.id),
    'Demo Distributor Inc.',
    'Opening stock'
  );

  -- Replay sales and returns in time order, each as its user.
  for v_event in
    select at, 'sale' as kind, seq from app.demo_plan
    union all
    select ret_at, 'return', seq from app.demo_plan where ret_at is not null
    order by 1
  loop
    if v_event.kind = 'sale' then
      perform set_config('request.jwt.claims',
        json_build_object('sub', (select actor from app.demo_plan where seq = v_event.seq), 'role', 'authenticated')::text, true);
      select public.create_sale(v_store, p.items, p.payments, gen_random_uuid(), p.customer, p.sale_discount)
        into v_sale_id
      from app.demo_plan p where p.seq = v_event.seq;
      update app.demo_plan set sale_id = v_sale_id where seq = v_event.seq;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      select si.id into v_item
      from app.demo_plan p
      join public.sale_items si on si.sale_id = p.sale_id and si.product_id = (p.items -> 0 ->> 'product_id')::uuid
      where p.seq = v_event.seq;
      perform public.create_return(
        p.sale_id,
        jsonb_build_array(jsonb_build_object('sale_item_id', v_item, 'quantity', 1, 'restock', p.ret_restock)),
        case when p.ret_restock then 'Changed their mind' else 'Damaged, written off' end,
        case when p.payments -> 0 ->> 'method' = 'transfer' then 'transfer'::public.payment_method
             when p.payments -> 0 ->> 'method' = 'card' then 'card'::public.payment_method
             else 'cash'::public.payment_method end)
      from app.demo_plan p where p.seq = v_event.seq;
    end if;
  end loop;

  -- Move it all into the past (triggers re-enabled right after, same transaction).
  perform set_config('request.jwt.claims', '', true);
  alter table public.activity_log disable trigger user;
  alter table public.sales disable trigger user;
  alter table public.returns disable trigger user;
  alter table public.products disable trigger user;
  alter table public.customers disable trigger user;
  alter table public.stock_entries disable trigger user;

  v_open := ((now() at time zone v_tz)::date - 61 + time '08:00') at time zone v_tz;
  -- Catalog, customers and the opening stock entry: 61 days ago.
  update public.products set created_at = v_open, updated_at = v_open where store_id = v_store;
  update public.customers set created_at = v_open, updated_at = v_open where store_id = v_store;
  update public.stock_entries set created_at = v_open where store_id = v_store;
  update public.stock_movements set created_at = v_open where store_id = v_store and type = 'entry';
  update public.activity_log set created_at = v_open where store_id = v_store;

  -- Sales: the sale, its payments, its stock movements and its log row.
  update public.sales s set created_at = p.at from app.demo_plan p where s.id = p.sale_id;
  update public.sale_payments sp set created_at = p.at from app.demo_plan p where sp.sale_id = p.sale_id;
  update public.stock_movements m set created_at = p.at
    from app.demo_plan p join public.sale_items si on si.sale_id = p.sale_id
   where m.ref_id = si.id;
  update public.activity_log a
     set created_at = p.at, after = jsonb_set(a.after, '{created_at}', to_jsonb(p.at))
    from app.demo_plan p
   where a.table_name = 'sales' and a.action = 'insert' and a.record_id = p.sale_id::text;

  -- Returns: the return, its movements, its log row and the sale's status change.
  update public.returns r set created_at = p.ret_at from app.demo_plan p where r.sale_id = p.sale_id and p.ret_at is not null;
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
    from app.demo_plan p
   where a.table_name = 'sales' and a.action = 'update' and a.record_id = p.sale_id::text;

  alter table public.activity_log enable trigger user;
  alter table public.sales enable trigger user;
  alter table public.returns enable trigger user;
  alter table public.products enable trigger user;
  alter table public.customers enable trigger user;
  alter table public.stock_entries enable trigger user;

  -- Two more sales today, by the cashier (the latest sale numbers).
  perform set_config('request.jwt.claims', json_build_object('sub', v_cashier, 'role', 'authenticated')::text, true);
  -- 2 cables + 1 charger = 2*9.99 + 19.99 = 39.97, paid cash (50.00 tendered).
  perform public.create_sale(
    v_store,
    '[{"product_id":"c0000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"c0000000-0000-4000-8000-000000000005","quantity":1}]',
    '[{"method":"cash","amount":39.97,"tendered":50.00}]',
    'e0000000-0000-4000-8000-000000000001',
    v_customers[1]
  );
  -- Earbuds with a 5.00 line discount = 54.99, paid by card.
  perform public.create_sale(
    v_store,
    '[{"product_id":"c0000000-0000-4000-8000-000000000011","quantity":1,"discount":5.00}]',
    '[{"method":"card","amount":54.99}]',
    'e0000000-0000-4000-8000-000000000002'
  );

  perform set_config('request.jwt.claims', '', true);

  -- Lock last: everything above ran as the demo users.
  if p_lock then
    alter table public.stores disable trigger user;
    update public.stores set is_demo = true where id = v_store;
    alter table public.stores enable trigger user;
  end if;

  select count(*) into v_sales from public.sales where store_id = v_store;
  select count(*) into v_returns from public.returns where store_id = v_store;
  truncate app.demo_plan;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return jsonb_build_object('store_id', v_store, 'sales', v_sales, 'returns', v_returns,
                            'locked', p_lock, 'credentials', v_credentials);
end;
$$;

revoke all on function public.reset_demo_store(text, boolean) from public, anon, authenticated;
grant execute on function public.reset_demo_store(text, boolean) to service_role;

comment on function public.reset_demo_store(text, boolean) is
  'Rebuilds the public demo store (phase 11). service_role / postgres only. Production: nightly pg_cron job.';
