-- =============================================================================
-- Triggers and transactional functions.
--
-- Stock rule: products.stock only changes inside create_stock_entry,
-- create_sale and create_return. Three independent guards enforce it:
--   1. authenticated has no INSERT/UPDATE privilege on products.stock
--      (security migration: column-level grants);
--   2. app.guard_stock() rejects any stock change that does not come from
--      those functions, even for service_role/postgres;
--   3. CHECK (stock >= 0) makes negative stock impossible.
--
-- SECURITY DEFINER functions below all use `set search_path = ''` and
-- fully-qualified names, and validate auth.uid(), store membership and role
-- themselves (they bypass RLS, so they must do the checks RLS would do).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Input validation helpers (raise 22023 invalid_parameter_value).
-- -----------------------------------------------------------------------------

-- Positive whole number from JSON. Rejects 1.5 instead of silently rounding.
create function app.parse_quantity(p_value jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  v := p_value::text::numeric;
  if v <> trunc(v) or v <= 0 or v > 1000000 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  return v::integer;
end;
$$;

-- Non-negative money amount with at most 2 decimals. JSON null/absent -> null.
create function app.parse_money(p_value jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  v := p_value::text::numeric;
  if v < 0 or v <> round(v, 2) or v > 9999999999.99 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Generic triggers
-- -----------------------------------------------------------------------------

create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Fills the column named in TG_ARGV[0] (created_by / invited_by) with the
-- current user, so clients cannot impersonate someone else. When there is no
-- user (service role, seed, migrations) the provided value is kept.
create function app.set_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], v_uid));
  end if;
  return new;
end;
$$;

-- New auth user -> profile row. SECURITY DEFINER because it runs as the auth
-- service's role, which has no privileges on public.profiles.
create function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Stock guard: only the stock functions set the transaction-local flag
-- app.stock_write = 'on'. Clients cannot set it through the API.
create function app.guard_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.stock_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.stock <> 0 then
    raise exception 'stock_is_read_only'
      using errcode = '42501',
            hint = 'New products start at 0; use create_stock_entry().';
  end if;
  if tg_op = 'UPDATE' and new.stock is distinct from old.stock then
    raise exception 'stock_is_read_only'
      using errcode = '42501',
            hint = 'Stock changes only through create_sale, create_return or create_stock_entry.';
  end if;
  return new;
end;
$$;

create trigger products_guard_stock
  before insert or update on public.products
  for each row execute function app.guard_stock();

-- A store must always keep at least one owner.
create function app.ensure_store_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.stores s where s.id = old.store_id)
     and not exists (
       select 1 from public.store_members m
       where m.store_id = old.store_id and m.role = 'owner'
     ) then
    raise exception 'store_needs_owner' using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger store_members_keep_owner
  after update or delete on public.store_members
  for each row execute function app.ensure_store_has_owner();

-- -----------------------------------------------------------------------------
-- Activity log
-- -----------------------------------------------------------------------------

-- TG_ARGV[0] = column holding the store id, TG_ARGV[1] = primary key column.
-- SECURITY DEFINER: authenticated has no INSERT privilege on activity_log.
-- Updates that only touch bookkeeping columns (updated_at, stock,
-- last_sale_number) are skipped: stock history lives in stock_movements.
create function app.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_noise text[] := array['updated_at', 'stock', 'last_sale_number'];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - 'token_hash';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - 'token_hash';
  end if;
  if tg_op = 'UPDATE' and (v_old - v_noise) = (v_new - v_noise) then
    return null;
  end if;

  v_row := coalesce(v_new, v_old);
  insert into public.activity_log (store_id, actor_id, table_name, record_id, action, before, after)
  values (
    (v_row ->> tg_argv[0])::uuid,
    auth.uid(),
    tg_table_name,
    v_row ->> tg_argv[1],
    lower(tg_op)::public.activity_action,
    v_old,
    v_new
  );
  return null;
end;
$$;

-- Append-only: nobody (not even service_role/postgres via the app) may
-- change or erase history.
create function app.block_activity_log_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'activity_log_is_append_only' using errcode = '42501';
end;
$$;

create trigger activity_log_no_update_delete
  before update or delete on public.activity_log
  for each row execute function app.block_activity_log_changes();

create trigger activity_log_no_truncate
  before truncate on public.activity_log
  for each statement execute function app.block_activity_log_changes();

-- -----------------------------------------------------------------------------
-- Trigger wiring
-- -----------------------------------------------------------------------------
create trigger stores_set_updated_at before update on public.stores
  for each row execute function app.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();
create trigger store_members_set_updated_at before update on public.store_members
  for each row execute function app.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function app.set_updated_at();
create trigger product_costs_set_updated_at before update on public.product_costs
  for each row execute function app.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
  for each row execute function app.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function app.set_updated_at();

create trigger stores_set_created_by before insert on public.stores
  for each row execute function app.set_actor('created_by');
create trigger products_set_created_by before insert on public.products
  for each row execute function app.set_actor('created_by');
create trigger customers_set_created_by before insert on public.customers
  for each row execute function app.set_actor('created_by');
create trigger invitations_set_invited_by before insert on public.invitations
  for each row execute function app.set_actor('invited_by');

create trigger stores_log after insert or update or delete on public.stores
  for each row execute function app.log_activity('id', 'id');
create trigger store_members_log after insert or update or delete on public.store_members
  for each row execute function app.log_activity('store_id', 'id');
create trigger invitations_log after insert or update or delete on public.invitations
  for each row execute function app.log_activity('store_id', 'id');
create trigger products_log after insert or update or delete on public.products
  for each row execute function app.log_activity('store_id', 'id');
create trigger product_costs_log after insert or update or delete on public.product_costs
  for each row execute function app.log_activity('store_id', 'product_id');
create trigger customers_log after insert or update or delete on public.customers
  for each row execute function app.log_activity('store_id', 'id');
create trigger stock_entries_log after insert or update or delete on public.stock_entries
  for each row execute function app.log_activity('store_id', 'id');
create trigger sales_log after insert or update or delete on public.sales
  for each row execute function app.log_activity('store_id', 'id');
create trigger returns_log after insert or update or delete on public.returns
  for each row execute function app.log_activity('store_id', 'id');

-- -----------------------------------------------------------------------------
-- create_stock_entry: receive merchandise (owner/admin).
--   p_items: [{ "product_id": uuid, "quantity": int > 0, "unit_cost": number >= 0 }]
-- Adds stock, records the ledger movement and updates the weighted average cost:
--   new_cost = (stock * current_cost + qty * unit_cost) / (stock + qty)
-- -----------------------------------------------------------------------------
create function public.create_stock_entry(
  p_store_id uuid,
  p_items jsonb,
  p_supplier text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_unit_cost numeric;
  v_old_stock integer;
  v_old_cost numeric;
  v_new_cost numeric;
  v_entry_item_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'product_id') from jsonb_array_elements(p_items) x)
     <> jsonb_array_length(p_items) then
    raise exception 'duplicate_product' using errcode = '22023';
  end if;

  insert into public.stock_entries (store_id, supplier, note, created_by)
  values (p_store_id, nullif(trim(p_supplier), ''), nullif(trim(p_note), ''), v_uid)
  returning id into v_entry_id;

  perform set_config('app.stock_write', 'on', true);

  -- Lock products in a fixed order (by id) to avoid deadlocks with sales.
  for v_item in
    select x from jsonb_array_elements(p_items) x order by (x ->> 'product_id')::uuid
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := app.parse_quantity(v_item -> 'quantity');
    v_unit_cost := app.parse_money(v_item -> 'unit_cost');
    if v_unit_cost is null then
      raise exception 'invalid_amount' using errcode = '22023';
    end if;

    select p.stock into v_old_stock
    from public.products p
    where p.id = v_product_id and p.store_id = p_store_id and p.deleted_at is null
    for update;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;

    select c.cost_price into v_old_cost
    from public.product_costs c
    where c.product_id = v_product_id
    for update;

    if v_old_cost is null or v_old_stock = 0 then
      v_new_cost := v_unit_cost;
    else
      v_new_cost := round((v_old_stock * v_old_cost + v_qty * v_unit_cost) / (v_old_stock + v_qty), 2);
    end if;

    insert into public.product_costs (product_id, store_id, cost_price)
    values (v_product_id, p_store_id, v_new_cost)
    on conflict (product_id) do update set cost_price = excluded.cost_price;

    update public.products set stock = stock + v_qty where id = v_product_id;

    insert into public.stock_entry_items (entry_id, store_id, product_id, quantity, unit_cost)
    values (v_entry_id, p_store_id, v_product_id, v_qty, v_unit_cost)
    returning id into v_entry_item_id;

    insert into public.stock_movements (store_id, product_id, type, quantity, stock_after, ref_id, created_by)
    values (p_store_id, v_product_id, 'entry', v_qty, v_old_stock + v_qty, v_entry_item_id, v_uid);
  end loop;

  perform set_config('app.stock_write', 'off', true);
  return v_entry_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_sale: register a sale (any member, including cashiers).
--   p_items:    [{ "product_id": uuid, "quantity": int > 0, "discount": number? }]
--   p_payments: [{ "method": "cash"|"card"|"transfer", "amount": number > 0, "tendered": number? }]
--   p_idempotency_key: generated by the client per checkout attempt; repeating
--   it returns the existing sale instead of charging twice.
-- Prices come from the database (never from the client). Taxes follow the
-- store settings and are snapshotted on the sale.
-- -----------------------------------------------------------------------------
create function public.create_sale(
  p_store_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_idempotency_key uuid,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_store public.stores%rowtype;
  v_sale_id uuid;
  v_item jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_pay jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty integer;
  v_line_discount numeric;
  v_gross numeric;
  v_line_total numeric;
  v_unit_cost numeric;
  v_subtotal numeric := 0;
  v_discount numeric;
  v_taxable numeric;
  v_tax numeric;
  v_total numeric;
  v_amount numeric;
  v_tendered numeric;
  v_method public.payment_method;
  v_pay_sum numeric := 0;
  v_sale_item_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not app.is_store_member(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'missing_idempotency_key' using errcode = '22023';
  end if;

  -- Serialize retries of the same checkout, then return the existing sale.
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || p_idempotency_key::text, 0));
  select s.id into v_sale_id
  from public.sales s
  where s.store_id = p_store_id and s.idempotency_key = p_idempotency_key;
  if found then
    return v_sale_id;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'product_id') from jsonb_array_elements(p_items) x)
     <> jsonb_array_length(p_items) then
    raise exception 'duplicate_product' using errcode = '22023';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'invalid_payments' using errcode = '22023';
  end if;

  v_discount := coalesce(p_discount, 0);
  if v_discount < 0 or v_discount <> round(v_discount, 2) then
    raise exception 'invalid_discount' using errcode = '22023';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.store_id = p_store_id
  ) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  -- Next consecutive number; also locks the store row for this transaction.
  update public.stores
  set last_sale_number = last_sale_number + 1
  where id = p_store_id
  returning * into v_store;

  perform set_config('app.stock_write', 'on', true);

  -- Pass 1: decrement stock atomically (row lock, fixed order) and price lines.
  for v_item in
    select x from jsonb_array_elements(p_items) x order by (x ->> 'product_id')::uuid
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := app.parse_quantity(v_item -> 'quantity');
    v_line_discount := coalesce(app.parse_money(v_item -> 'discount'), 0);

    update public.products p
    set stock = p.stock - v_qty
    where p.id = v_product_id
      and p.store_id = p_store_id
      and p.deleted_at is null
      and p.active
      and p.stock >= v_qty
    returning * into v_product;

    if not found then
      if exists (
        select 1 from public.products p
        where p.id = v_product_id and p.store_id = p_store_id
          and p.deleted_at is null and p.active
      ) then
        raise exception 'insufficient_stock' using errcode = '23514', detail = v_product_id::text;
      end if;
      raise exception 'product_not_found' using errcode = 'P0002', detail = v_product_id::text;
    end if;

    v_gross := v_product.sale_price * v_qty;
    if v_line_discount > v_gross then
      raise exception 'invalid_discount' using errcode = '22023';
    end if;
    v_line_total := v_gross - v_line_discount;
    v_subtotal := v_subtotal + v_line_total;

    select c.cost_price into v_unit_cost
    from public.product_costs c
    where c.product_id = v_product_id;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'sku', v_product.sku,
      'unit_price', v_product.sale_price,
      'quantity', v_qty,
      'discount', v_line_discount,
      'line_total', v_line_total,
      'unit_cost', coalesce(v_unit_cost, 0),
      'stock_after', v_product.stock
    );
  end loop;

  if v_discount > v_subtotal then
    raise exception 'invalid_discount' using errcode = '22023';
  end if;

  -- Taxes. Included: the price already contains the tax, extract it.
  --        Added:    tax is computed on top of the (discounted) subtotal.
  v_taxable := v_subtotal - v_discount;
  if v_store.prices_include_tax then
    v_total := v_taxable;
    v_tax := round(v_taxable * v_store.tax_rate / (1 + v_store.tax_rate), 2);
  else
    v_tax := round(v_taxable * v_store.tax_rate, 2);
    v_total := v_taxable + v_tax;
  end if;

  -- Validate payments before writing anything else.
  for v_pay in select x from jsonb_array_elements(p_payments) x loop
    v_amount := app.parse_money(v_pay -> 'amount');
    if v_amount is null or v_amount <= 0 then
      raise exception 'invalid_amount' using errcode = '22023';
    end if;
    v_pay_sum := v_pay_sum + v_amount;
  end loop;
  if v_pay_sum <> v_total then
    raise exception 'payments_mismatch' using errcode = '22023',
      detail = format('total=%s paid=%s', v_total, v_pay_sum);
  end if;

  insert into public.sales (
    store_id, number, customer_id, cashier_id, subtotal, discount_total,
    tax_rate, prices_include_tax, tax_total, total, status, idempotency_key, note
  )
  values (
    p_store_id, v_store.last_sale_number, p_customer_id, v_uid, v_subtotal, v_discount,
    v_store.tax_rate, v_store.prices_include_tax, v_tax, v_total, 'completed',
    p_idempotency_key, nullif(trim(p_note), '')
  )
  returning id into v_sale_id;

  -- Pass 2: persist lines, cost snapshots and ledger movements.
  for v_line in select x from jsonb_array_elements(v_lines) x loop
    insert into public.sale_items (
      sale_id, store_id, product_id, product_name, sku, unit_price, quantity, discount, line_total
    )
    values (
      v_sale_id, p_store_id, (v_line ->> 'product_id')::uuid, v_line ->> 'name', v_line ->> 'sku',
      (v_line ->> 'unit_price')::numeric, (v_line ->> 'quantity')::integer,
      (v_line ->> 'discount')::numeric, (v_line ->> 'line_total')::numeric
    )
    returning id into v_sale_item_id;

    insert into public.sale_item_costs (sale_item_id, store_id, unit_cost)
    values (v_sale_item_id, p_store_id, (v_line ->> 'unit_cost')::numeric);

    insert into public.stock_movements (store_id, product_id, type, quantity, stock_after, ref_id, created_by)
    values (
      p_store_id, (v_line ->> 'product_id')::uuid, 'sale', -((v_line ->> 'quantity')::integer),
      (v_line ->> 'stock_after')::integer, v_sale_item_id, v_uid
    );
  end loop;

  for v_pay in select x from jsonb_array_elements(p_payments) x loop
    v_method := (v_pay ->> 'method')::public.payment_method;
    v_amount := app.parse_money(v_pay -> 'amount');
    v_tendered := app.parse_money(v_pay -> 'tendered');
    insert into public.sale_payments (sale_id, store_id, method, amount, tendered)
    values (v_sale_id, p_store_id, v_method, v_amount, v_tendered);
  end loop;

  perform set_config('app.stock_write', 'off', true);
  return v_sale_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_return: return items of a sale (owner/admin only).
--   p_items: [{ "sale_item_id": uuid, "quantity": int > 0 }]
-- Quantity can never exceed sold - already returned. The refund is the line's
-- share of the sale total (so sale discounts and taxes are refunded
-- proportionally); a return that completes the sale refunds exactly what is left.
-- -----------------------------------------------------------------------------
create function public.create_return(
  p_sale_id uuid,
  p_items jsonb,
  p_reason text default null,
  p_refund_method public.payment_method default 'cash'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sale public.sales%rowtype;
  v_return_id uuid;
  v_item jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_sale_item public.sale_items%rowtype;
  v_qty integer;
  v_already integer;
  v_refund numeric;
  v_refund_total numeric := 0;
  v_already_refunded numeric;
  v_remaining_units integer;
  v_return_item_id uuid;
  v_stock_after integer;
  v_last_index integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_sale from public.sales s where s.id = p_sale_id for update;
  -- Same error for "does not exist" and "other store": never leak other tenants' ids.
  if not found or not app.is_store_member(v_sale.store_id) then
    raise exception 'sale_not_found' using errcode = 'P0002';
  end if;
  if not app.is_store_manager(v_sale.store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'sale_item_id') from jsonb_array_elements(p_items) x)
     <> jsonb_array_length(p_items) then
    raise exception 'duplicate_item' using errcode = '22023';
  end if;

  -- Pass 1: validate quantities and compute refunds.
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_qty := app.parse_quantity(v_item -> 'quantity');

    select * into v_sale_item
    from public.sale_items si
    where si.id = (v_item ->> 'sale_item_id')::uuid and si.sale_id = p_sale_id;
    if not found then
      raise exception 'sale_item_not_found' using errcode = 'P0002';
    end if;

    select coalesce(sum(ri.quantity), 0) into v_already
    from public.return_items ri
    where ri.sale_item_id = v_sale_item.id;

    if v_qty > v_sale_item.quantity - v_already then
      raise exception 'return_exceeds_sold' using errcode = '23514',
        detail = format('sold=%s returned=%s requested=%s', v_sale_item.quantity, v_already, v_qty);
    end if;

    if v_sale.subtotal = 0 then
      v_refund := 0;
    else
      v_refund := round(v_sale.total * (v_sale_item.line_total * v_qty / v_sale_item.quantity) / v_sale.subtotal, 2);
    end if;
    v_refund_total := v_refund_total + v_refund;

    v_lines := v_lines || jsonb_build_object(
      'sale_item_id', v_sale_item.id,
      'product_id', v_sale_item.product_id,
      'quantity', v_qty,
      'refund', v_refund
    );
  end loop;

  -- Rounding: never refund more than what is left, and refund exactly the
  -- remainder when this return completes the sale.
  select coalesce(sum(r.refund_total), 0) into v_already_refunded
  from public.returns r where r.sale_id = p_sale_id;

  select coalesce(sum(si.quantity), 0)
       - coalesce((select sum(ri.quantity) from public.return_items ri
                   join public.sale_items s2 on s2.id = ri.sale_item_id
                   where s2.sale_id = p_sale_id), 0)
       - (select sum((x ->> 'quantity')::integer) from jsonb_array_elements(v_lines) x)
    into v_remaining_units
  from public.sale_items si where si.sale_id = p_sale_id;

  if v_remaining_units = 0 or v_refund_total > v_sale.total - v_already_refunded then
    v_last_index := jsonb_array_length(v_lines) - 1;
    v_refund := (v_lines -> v_last_index ->> 'refund')::numeric
              + (v_sale.total - v_already_refunded - v_refund_total);
    v_lines := jsonb_set(v_lines, array[v_last_index::text, 'refund'], to_jsonb(greatest(v_refund, 0)));
    v_refund_total := v_sale.total - v_already_refunded;
  end if;

  insert into public.returns (store_id, sale_id, reason, refund_total, refund_method, created_by)
  values (v_sale.store_id, p_sale_id, nullif(trim(p_reason), ''), v_refund_total, p_refund_method, v_uid)
  returning id into v_return_id;

  perform set_config('app.stock_write', 'on', true);

  -- Pass 2: persist items and put stock back (fixed product order).
  for v_line in
    select x from jsonb_array_elements(v_lines) x order by (x ->> 'product_id')::uuid
  loop
    insert into public.return_items (return_id, store_id, sale_item_id, quantity, refund_amount)
    values (
      v_return_id, v_sale.store_id, (v_line ->> 'sale_item_id')::uuid,
      (v_line ->> 'quantity')::integer, (v_line ->> 'refund')::numeric
    )
    returning id into v_return_item_id;

    update public.products p
    set stock = p.stock + (v_line ->> 'quantity')::integer
    where p.id = (v_line ->> 'product_id')::uuid
    returning p.stock into v_stock_after;

    insert into public.stock_movements (store_id, product_id, type, quantity, stock_after, ref_id, created_by)
    values (
      v_sale.store_id, (v_line ->> 'product_id')::uuid, 'return',
      (v_line ->> 'quantity')::integer, v_stock_after, v_return_item_id, v_uid
    );
  end loop;

  perform set_config('app.stock_write', 'off', true);

  update public.sales
  set status = case when v_remaining_units = 0 then 'returned' else 'partially_returned' end::public.sale_status
  where id = p_sale_id;

  return v_return_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execute privileges. Public-schema functions are exposed by PostgREST as
-- /rest/v1/rpc/<name>; only signed-in users may call them.
-- -----------------------------------------------------------------------------
revoke execute on function public.create_stock_entry(uuid, jsonb, text, text) from public, anon;
revoke execute on function public.create_sale(uuid, jsonb, jsonb, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.create_return(uuid, jsonb, text, public.payment_method) from public, anon;
grant execute on function public.create_stock_entry(uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.create_sale(uuid, jsonb, jsonb, uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.create_return(uuid, jsonb, text, public.payment_method) to authenticated, service_role;

-- Internal helpers/triggers in "app": not callable by clients.
revoke execute on all functions in schema app from public, anon;
grant execute on function app.is_store_member(uuid), app.has_store_role(uuid, public.store_role[]),
  app.is_store_manager(uuid), app.shares_store_with(uuid)
  to authenticated, service_role;
