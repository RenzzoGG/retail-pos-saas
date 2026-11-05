-- =============================================================================
-- Phase 7: returns with write-offs, and customers with soft delete.
--   * create_return: each item may say "restock": false (damaged). It is still
--     refunded, but the units don't go back to stock and no movement is written.
--   * customers.deleted_at (added by Drizzle) is set only by delete_customer();
--     it has no column grant, so members can edit customers but not "delete"
--     them through UPDATE.
--   * create_sale no longer accepts archived customers.
-- Same signatures and grants as before for create_return and create_sale.
-- =============================================================================

create or replace function public.create_return(
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
  v_restock boolean;
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
    -- Phase 7: "restock": false = damaged/written off (refund, but no stock back).
    if v_item ? 'restock' and jsonb_typeof(v_item -> 'restock') <> 'boolean' then
      raise exception 'invalid_items' using errcode = '22023';
    end if;
    v_restock := coalesce((v_item ->> 'restock')::boolean, true);

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
      'refund', v_refund,
      'restock', v_restock
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
    insert into public.return_items (return_id, store_id, sale_item_id, quantity, refund_amount, restocked)
    values (
      v_return_id, v_sale.store_id, (v_line ->> 'sale_item_id')::uuid,
      (v_line ->> 'quantity')::integer, (v_line ->> 'refund')::numeric, (v_line ->> 'restock')::boolean
    )
    returning id into v_return_item_id;

    -- Written-off units don't go back to stock (and leave no stock movement).
    continue when not (v_line ->> 'restock')::boolean;

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

create or replace function public.create_sale(
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
  v_gross_total numeric := 0;
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
    select 1 from public.customers c
    where c.id = p_customer_id and c.store_id = p_store_id and c.deleted_at is null
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
    v_gross_total := v_gross_total + v_gross;
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

  -- Cashier discount limit (phase 6): line + sale discounts as a % of the
  -- gross amount (prices x quantities). Owners/admins have no limit.
  if v_gross_total > 0
     and (v_gross_total - v_subtotal) + v_discount > 0
     and app.has_store_role(p_store_id, array['cashier']::public.store_role[])
     and ((v_gross_total - v_subtotal) + v_discount) * 100 > v_store.max_cashier_discount_pct * v_gross_total then
    raise exception 'discount_limit_exceeded' using errcode = '42501',
      detail = format('limit=%s', v_store.max_cashier_discount_pct);
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

-- Owner/admin. Customers with sales are archived (soft delete) so past sales
-- keep their customer; customers without sales are deleted.
create function public.delete_customer(p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select c.store_id into v_store_id
  from public.customers c
  where c.id = p_customer_id and c.deleted_at is null
  for update;
  -- Same error for "doesn't exist" and "another store's customer".
  if not found or not app.is_store_member(v_store_id) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;
  if not app.is_store_manager(v_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if exists (select 1 from public.sales s where s.customer_id = p_customer_id) then
    update public.customers set deleted_at = now() where id = p_customer_id;
    return 'archived';
  end if;
  delete from public.customers where id = p_customer_id;
  return 'deleted';
end;
$$;

revoke execute on function public.delete_customer(uuid) from public, anon;
grant execute on function public.delete_customer(uuid) to authenticated, service_role;
