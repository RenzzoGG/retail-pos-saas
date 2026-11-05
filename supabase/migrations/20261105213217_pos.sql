-- =============================================================================
-- Phase 6: point of sale.
--   * stores.max_cashier_discount_pct (added by Drizzle) is editable by owner/admin.
--   * create_sale enforces it: a cashier's total discount (line + sale) can't
--     exceed that % of the gross amount. Same signature and grants as before;
--     everything else in the function is unchanged.
-- =============================================================================

grant update (max_cashier_discount_pct) on public.stores to authenticated;

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
