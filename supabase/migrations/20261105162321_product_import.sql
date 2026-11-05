-- =============================================================================
-- Phase 5: product import from Excel/CSV.
--
-- The app parses and validates the file (preview), then sends the valid rows
-- to public.import_products, which re-validates them and saves everything in
-- ONE transaction: all valid rows, or nothing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared stock-receiving logic. create_stock_entry (Receive stock screen) and
-- import_products both use it; only the "source" differs. Internal helper:
-- callers check permissions first; clients cannot call it.
-- -----------------------------------------------------------------------------
create function app.receive_stock(
  p_store_id uuid,
  p_items jsonb,
  p_supplier text,
  p_note text,
  p_source text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'product_id') from jsonb_array_elements(p_items) x)
     <> jsonb_array_length(p_items) then
    raise exception 'duplicate_product' using errcode = '22023';
  end if;

  insert into public.stock_entries (store_id, supplier, note, source, created_by)
  values (p_store_id, nullif(trim(p_supplier), ''), nullif(trim(p_note), ''), p_source, p_actor)
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

    -- Weighted average: (stock * current cost + qty * unit cost) / (stock + qty)
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
    values (p_store_id, v_product_id, 'entry', v_qty, v_old_stock + v_qty, v_entry_item_id, p_actor);
  end loop;

  perform set_config('app.stock_write', 'off', true);
  return v_entry_id;
end;
$$;

revoke execute on function app.receive_stock(uuid, jsonb, text, text, text, uuid) from public, anon, authenticated;

-- Same signature and behaviour as before; now delegates to app.receive_stock.
create or replace function public.create_stock_entry(
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
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return app.receive_stock(p_store_id, p_items, p_supplier, p_note, 'manual', v_uid);
end;
$$;

-- Non-negative whole number from JSON; JSON null/absent -> null.
create function app.parse_non_negative_int(p_value jsonb)
returns integer
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
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  v := p_value::text::numeric;
  if v <> trunc(v) or v < 0 or v > 1000000 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  return v::integer;
end;
$$;

revoke execute on function app.parse_non_negative_int(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- import_batches: history of confirmed imports. Owner/admin read; written only
-- by import_products.
-- -----------------------------------------------------------------------------
alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated;
grant all on public.import_batches to service_role;
grant select on public.import_batches to authenticated;

create policy import_batches_select_manager on public.import_batches
  for select to authenticated
  using (app.is_store_manager(store_id));

create trigger import_batches_log after insert or update or delete on public.import_batches
  for each row execute function app.log_activity('store_id', 'id');

-- -----------------------------------------------------------------------------
-- import_products: saves the valid rows of an import atomically.
--   p_rows: [{ "name", "sku", "barcode"?, "category"?, "sale_price",
--              "low_stock_threshold"?, "initial_stock"?, "unit_cost"? }]
--   p_update_existing: false -> a row whose SKU exists aborts the import;
--                      true  -> existing products (same SKU) are updated.
-- Initial stock is never written directly: rows with stock become ONE stock
-- entry with source = 'import' (weighted average cost, ledger movements).
-- Any error (invalid row, duplicate, a product changed since the preview)
-- rolls back everything.
-- -----------------------------------------------------------------------------
create function public.import_products(
  p_store_id uuid,
  p_file_name text,
  p_update_existing boolean,
  p_total_rows integer,
  p_skipped_rows integer,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_index integer := 0;
  v_name text;
  v_sku text;
  v_barcode text;
  v_category text;
  v_price numeric;
  v_threshold integer;
  v_stock integer;
  v_cost numeric;
  v_product_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_entry_id uuid;
  v_batch_id uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count = 0 or v_count > 2000 then
    raise exception 'invalid_row_count' using errcode = '22023';
  end if;
  if p_skipped_rows is null or p_skipped_rows < 0 or p_total_rows is distinct from v_count + p_skipped_rows then
    raise exception 'invalid_row_count' using errcode = '22023';
  end if;
  if p_file_name is null or length(trim(p_file_name)) = 0 or length(p_file_name) > 255 then
    raise exception 'invalid_file_name' using errcode = '22023';
  end if;

  -- Duplicates inside the payload (the preview already rejects them).
  if (select count(distinct trim(x ->> 'sku')) from jsonb_array_elements(p_rows) x) <> v_count then
    raise exception 'duplicate_sku' using errcode = '23505';
  end if;
  if (select count(nullif(trim(x ->> 'barcode'), '')) - count(distinct nullif(trim(x ->> 'barcode'), ''))
      from jsonb_array_elements(p_rows) x) > 0 then
    raise exception 'duplicate_barcode' using errcode = '23505';
  end if;

  for v_row in select x from jsonb_array_elements(p_rows) x loop
    v_index := v_index + 1;
    v_name := trim(v_row ->> 'name');
    v_sku := trim(v_row ->> 'sku');
    v_barcode := nullif(trim(v_row ->> 'barcode'), '');
    v_category := nullif(trim(v_row ->> 'category'), '');
    v_price := app.parse_money(v_row -> 'sale_price');
    v_threshold := coalesce(app.parse_non_negative_int(v_row -> 'low_stock_threshold'), 0);
    v_stock := coalesce(app.parse_non_negative_int(v_row -> 'initial_stock'), 0);
    v_cost := app.parse_money(v_row -> 'unit_cost');

    if v_name is null or v_name = '' or length(v_name) > 120
       or v_sku is null or v_sku = '' or length(v_sku) > 64 or v_sku ~ '\s'
       or (v_barcode is not null and v_barcode !~ '^[0-9A-Za-z-]{4,64}$')
       or (v_category is not null and length(v_category) > 60)
       or v_price is null
       or (v_stock > 0 and v_cost is null)
       or (v_stock = 0 and v_cost is not null) then
      raise exception 'invalid_row' using errcode = '22023', detail = format('row %s', v_index);
    end if;

    select p.id into v_product_id
    from public.products p
    where p.store_id = p_store_id and p.sku = v_sku and p.deleted_at is null
    for update;

    if found then
      if not coalesce(p_update_existing, false) then
        raise exception 'sku_exists' using errcode = '23505', detail = v_sku;
      end if;
      update public.products
      set name = v_name, barcode = v_barcode, category = v_category,
          sale_price = v_price, low_stock_threshold = v_threshold
      where id = v_product_id;
      v_updated := v_updated + 1;
    else
      insert into public.products (store_id, sku, barcode, name, category, sale_price, low_stock_threshold, created_by)
      values (p_store_id, v_sku, v_barcode, v_name, v_category, v_price, v_threshold, v_uid)
      returning id into v_product_id;
      v_created := v_created + 1;
    end if;

    if v_stock > 0 then
      v_items := v_items || jsonb_build_object('product_id', v_product_id, 'quantity', v_stock, 'unit_cost', v_cost);
    end if;
  end loop;

  if jsonb_array_length(v_items) > 0 then
    v_entry_id := app.receive_stock(p_store_id, v_items, null, 'Import: ' || trim(p_file_name), 'import', v_uid);
  end if;

  insert into public.import_batches (
    store_id, file_name, update_existing, total_rows, created_count, updated_count, skipped_count,
    stock_entry_id, created_by
  )
  values (
    p_store_id, trim(p_file_name), coalesce(p_update_existing, false), p_total_rows, v_created, v_updated,
    p_skipped_rows, v_entry_id, v_uid
  )
  returning id into v_batch_id;

  return v_batch_id;
end;
$$;

revoke execute on function public.import_products(uuid, text, boolean, integer, integer, jsonb) from public, anon;
grant execute on function public.import_products(uuid, text, boolean, integer, integer, jsonb) to authenticated, service_role;
