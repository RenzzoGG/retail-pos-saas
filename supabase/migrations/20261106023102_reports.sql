-- =============================================================================
-- Phase 8: dashboard and reports, computed in the database.
--
-- SECURITY INVOKER everywhere: the functions run with the caller's rights, so
-- RLS applies to every table they read (another store's rows are simply not
-- visible). Nothing here bypasses RLS.
--
-- Profit is protected twice:
--   1. every function that uses costs starts with app.is_store_manager() and
--      raises 'forbidden' for cashiers -> they get an error, never a number;
--   2. even without that check, RLS hides sale_item_costs from cashiers (the
--      result would be wrong, but no cost would leak). The check is mandatory.
--
-- Periods: [p_from, p_to) as timestamptz, computed by the server in the store's
-- time zone. Returns count on the RETURN date (closed periods never change);
-- over the whole history the result equals the per-sale profit.
--
-- Profit = Σ(total − tax) of the sales in the period
--        − Σ cost of the units sold in the period
--        − Σ (refund − its tax share) of the returns in the period
--        + Σ cost of the returned units that went back to stock.
-- Write-offs (returned, not restocked) are not added back: they stay a loss,
-- and are also reported on their own.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Building blocks (schema app: not exposed through the API). Plain SQL, stable
-- and invoker, so the planner can inline them into the callers.
-- -----------------------------------------------------------------------------

create function app.check_report_range(p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
end;
$$;

-- One row per sale in the period, with its cost (null for non-managers: RLS).
create function app.sale_facts(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  sale_id uuid, created_at timestamptz, cashier_id uuid,
  total numeric, tax_total numeric, subtotal numeric, sale_discount numeric,
  line_discounts numeric, units integer, cost numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.created_at, s.cashier_id, s.total, s.tax_total, s.subtotal, s.discount_total,
         coalesce(l.line_discounts, 0), coalesce(l.units, 0)::integer, coalesce(l.cost, 0)
  from public.sales s
  left join lateral (
    select sum(si.discount) as line_discounts,
           sum(si.quantity) as units,
           sum(si.quantity * c.unit_cost) as cost
    from public.sale_items si
    left join public.sale_item_costs c on c.sale_item_id = si.id
    where si.sale_id = s.id
  ) l on true
  where s.store_id = p_store_id and s.created_at >= p_from and s.created_at < p_to;
$$;

-- One row per return in the period: refund, its tax share, restocked and written-off cost.
create function app.return_facts(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  return_id uuid, created_at timestamptz, refund_method public.payment_method,
  refund_total numeric, refund_tax numeric, units integer, written_off_units integer,
  restocked_cost numeric, write_off_cost numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.created_at, r.refund_method, r.refund_total,
         case when s.total > 0 then r.refund_total * s.tax_total / s.total else 0 end,
         coalesce(l.units, 0)::integer, coalesce(l.written_off_units, 0)::integer,
         coalesce(l.restocked_cost, 0), coalesce(l.write_off_cost, 0)
  from public.returns r
  join public.sales s on s.id = r.sale_id
  left join lateral (
    select sum(ri.quantity) as units,
           sum(ri.quantity) filter (where not ri.restocked) as written_off_units,
           sum(ri.quantity * c.unit_cost) filter (where ri.restocked) as restocked_cost,
           sum(ri.quantity * c.unit_cost) filter (where not ri.restocked) as write_off_cost
    from public.return_items ri
    left join public.sale_item_costs c on c.sale_item_id = ri.sale_item_id
    where ri.return_id = r.id
  ) l on true
  where r.store_id = p_store_id and r.created_at >= p_from and r.created_at < p_to;
$$;

-- -----------------------------------------------------------------------------
-- Owner/admin reports
-- -----------------------------------------------------------------------------

create function public.report_summary(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  sales_count integer, units_sold integer, gross_sales numeric, discounts numeric, tax numeric,
  avg_ticket numeric, returns_count integer, units_returned integer, refunds numeric,
  net_sales numeric, cost_of_sales numeric, restocked_cost numeric, write_off_units integer,
  write_off_cost numeric, profit numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);

  return query
  with s as (
    select count(*)::integer as n, coalesce(sum(f.units), 0)::integer as units,
           coalesce(sum(f.total), 0) as gross, coalesce(sum(f.sale_discount + f.line_discounts), 0) as discounts,
           coalesce(sum(f.tax_total), 0) as tax, coalesce(sum(f.cost), 0) as cost
    from app.sale_facts(p_store_id, p_from, p_to) f
  ), r as (
    select count(*)::integer as n, coalesce(sum(f.units), 0)::integer as units,
           coalesce(sum(f.refund_total), 0) as refunds, coalesce(sum(f.refund_tax), 0) as refund_tax,
           coalesce(sum(f.restocked_cost), 0) as restocked, coalesce(sum(f.written_off_units), 0)::integer as wo_units,
           coalesce(sum(f.write_off_cost), 0) as wo_cost
    from app.return_facts(p_store_id, p_from, p_to) f
  )
  select s.n, s.units, s.gross, s.discounts, round(s.tax - r.refund_tax, 2),
         case when s.n > 0 then round(s.gross / s.n, 2) else 0 end,
         r.n, r.units, r.refunds, s.gross - r.refunds,
         s.cost, r.restocked, r.wo_units, r.wo_cost,
         round((s.gross - s.tax) - s.cost - (r.refunds - r.refund_tax) + r.restocked, 2)
  from s, r;
end;
$$;

-- Sales, refunds, net and profit per day or month (store time zone), gaps included.
create function public.report_timeseries(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text default 'day'
)
returns table (
  bucket date, sales_count integer, gross_sales numeric, refunds numeric, net_sales numeric, profit numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text;
  v_step interval;
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);
  if p_bucket not in ('day', 'month') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  select st.timezone into v_tz from public.stores st where st.id = p_store_id;
  v_step := case p_bucket when 'day' then interval '1 day' else interval '1 month' end;

  return query
  with buckets as (
    select g::date as b
    from generate_series(
      date_trunc(p_bucket, p_from at time zone v_tz),
      date_trunc(p_bucket, (p_to - interval '1 microsecond') at time zone v_tz),
      v_step
    ) g
  ), s as (
    select date_trunc(p_bucket, f.created_at at time zone v_tz)::date as b,
           count(*)::integer as n, sum(f.total) as gross, sum(f.total - f.tax_total - f.cost) as margin
    from app.sale_facts(p_store_id, p_from, p_to) f
    group by 1
  ), r as (
    select date_trunc(p_bucket, f.created_at at time zone v_tz)::date as b,
           sum(f.refund_total) as refunds,
           sum((f.refund_total - f.refund_tax) - f.restocked_cost) as lost_margin
    from app.return_facts(p_store_id, p_from, p_to) f
    group by 1
  )
  select buckets.b, coalesce(s.n, 0), coalesce(s.gross, 0), coalesce(r.refunds, 0),
         coalesce(s.gross, 0) - coalesce(r.refunds, 0),
         round(coalesce(s.margin, 0) - coalesce(r.lost_margin, 0), 2)
  from buckets
  left join s on s.b = buckets.b
  left join r on r.b = buckets.b
  order by buckets.b;
end;
$$;

-- Per product: units and revenue sold in the period (share of what was charged,
-- sale discount included) and what was returned in the period. No limit.
create function app.product_facts(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (product_id uuid, units_sold integer, units_returned integer, net_sales numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with sold as (
    select si.product_id, sum(si.quantity) as units,
           sum(case when s.subtotal > 0 then si.line_total * s.total / s.subtotal else 0 end) as revenue
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    where s.store_id = p_store_id and s.created_at >= p_from and s.created_at < p_to
    group by si.product_id
  ), returned as (
    select si.product_id, sum(ri.quantity) as units, sum(ri.refund_amount) as refunds
    from public.returns r
    join public.return_items ri on ri.return_id = r.id
    join public.sale_items si on si.id = ri.sale_item_id
    where r.store_id = p_store_id and r.created_at >= p_from and r.created_at < p_to
    group by si.product_id
  )
  select coalesce(sold.product_id, returned.product_id),
         coalesce(sold.units, 0)::integer,
         coalesce(returned.units, 0)::integer,
         coalesce(sold.revenue, 0) - coalesce(returned.refunds, 0)
  from sold
  full join returned on returned.product_id = sold.product_id;
$$;

-- Best sellers by net units or net revenue.
create function public.report_products(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_order text default 'units', p_limit integer default 10
)
returns table (
  product_id uuid, sku text, name text, category text,
  units_sold integer, units_returned integer, net_units integer, net_sales numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);
  if p_order not in ('units', 'revenue') then
    raise exception 'invalid_order' using errcode = '22023';
  end if;

  return query
  select f.product_id, p.sku, p.name, p.category, f.units_sold, f.units_returned,
         f.units_sold - f.units_returned, round(f.net_sales, 2)
  from app.product_facts(p_store_id, p_from, p_to) f
  join public.products p on p.id = f.product_id
  order by case when p_order = 'units' then (f.units_sold - f.units_returned)::numeric else f.net_sales end desc,
           p.name
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end;
$$;

create function public.report_categories(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (category text, net_units integer, net_sales numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);

  return query
  select coalesce(nullif(trim(p.category), ''), 'Uncategorized'),
         sum(f.units_sold - f.units_returned)::integer, round(sum(f.net_sales), 2)
  from app.product_facts(p_store_id, p_from, p_to) f
  join public.products p on p.id = f.product_id
  group by 1
  order by 3 desc, 1;
end;
$$;

-- Money taken per method (payments) minus money given back (refunds).
create function public.report_payment_methods(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (method public.payment_method, payments_count integer, collected numeric, refunds numeric, net numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);

  return query
  with paid as (
    select sp.method, count(*)::integer as n, sum(sp.amount) as amount
    from public.sale_payments sp
    where sp.store_id = p_store_id and sp.created_at >= p_from and sp.created_at < p_to
    group by sp.method
  ), refunded as (
    select r.refund_method as method, sum(r.refund_total) as amount
    from public.returns r
    where r.store_id = p_store_id and r.created_at >= p_from and r.created_at < p_to
    group by r.refund_method
  )
  select m, coalesce(paid.n, 0), coalesce(paid.amount, 0), coalesce(refunded.amount, 0),
         coalesce(paid.amount, 0) - coalesce(refunded.amount, 0)
  from unnest(enum_range(null::public.payment_method)) m
  left join paid on paid.method = m
  left join refunded on refunded.method = m
  order by 5 desc, 1;
end;
$$;

create function public.report_cashiers(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (cashier_id uuid, cashier_name text, sales_count integer, gross_sales numeric, avg_ticket numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);

  return query
  select s.cashier_id, coalesce(pr.full_name, 'Former member'), count(*)::integer, sum(s.total),
         round(sum(s.total) / count(*), 2)
  from public.sales s
  left join public.profiles pr on pr.id = s.cashier_id
  where s.store_id = p_store_id and s.created_at >= p_from and s.created_at < p_to
  group by s.cashier_id, pr.full_name
  order by 4 desc, 2;
end;
$$;

-- Excel export: one row per sale made in the period. Refunds are "to date" for
-- that sale, and profit is the per-sale profit after returns (same as the sale page).
create function public.report_sales_export(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  number integer, created_at timestamptz, cashier_name text, customer_name text, status public.sale_status,
  units integer, items_subtotal numeric, line_discounts numeric, sale_discount numeric, tax numeric,
  total numeric, refunded numeric, net numeric, payment_methods text, cost numeric, profit numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);

  return query
  select s.number, s.created_at, coalesce(pr.full_name, 'Former member'), c.name, s.status,
         f.units, s.subtotal + f.line_discounts, f.line_discounts, s.discount_total, s.tax_total, s.total,
         coalesce(rf.refunded, 0), s.total - coalesce(rf.refunded, 0),
         (select string_agg(initcap(x.method::text), ' + ' order by x.first)
          from (select sp.method, min(sp.created_at) as first from public.sale_payments sp
                where sp.sale_id = s.id group by sp.method) x),
         f.cost,
         round(case when s.total > 0 then (s.total - s.tax_total) * (s.total - coalesce(rf.refunded, 0)) / s.total else 0 end
               - (f.cost - coalesce(rf.restocked_cost, 0)), 2)
  from public.sales s
  join app.sale_facts(p_store_id, p_from, p_to) f on f.sale_id = s.id
  left join public.profiles pr on pr.id = s.cashier_id
  left join public.customers c on c.id = s.customer_id
  left join lateral (
    select sum(ri.refund_amount) as refunded,
           sum(ri.quantity * co.unit_cost) filter (where ri.restocked) as restocked_cost
    from public.return_items ri
    join public.returns r on r.id = ri.return_id
    left join public.sale_item_costs co on co.sale_item_id = ri.sale_item_id
    where r.sale_id = s.id
  ) rf on true
  order by s.number;
end;
$$;

-- Excel export: the lines of those sales.
create function public.report_sale_lines_export(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  sale_number integer, created_at timestamptz, sku text, product_name text, category text,
  quantity integer, unit_price numeric, discount numeric, line_total numeric,
  returned_qty integer, written_off_qty integer, unit_cost numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_store_manager(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.check_report_range(p_from, p_to);

  return query
  select s.number, s.created_at, si.sku, si.product_name, p.category, si.quantity, si.unit_price,
         si.discount, si.line_total, coalesce(rt.qty, 0)::integer, coalesce(rt.written_off, 0)::integer,
         co.unit_cost
  from public.sales s
  join public.sale_items si on si.sale_id = s.id
  left join public.products p on p.id = si.product_id
  left join public.sale_item_costs co on co.sale_item_id = si.id
  left join lateral (
    select sum(ri.quantity) as qty, sum(ri.quantity) filter (where not ri.restocked) as written_off
    from public.return_items ri where ri.sale_item_id = si.id
  ) rt on true
  where s.store_id = p_store_id and s.created_at >= p_from and s.created_at < p_to
  order by s.number, si.product_name, si.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Any member: today's sales of the store and of the caller. No costs.
-- -----------------------------------------------------------------------------
create function public.dashboard_today(p_store_id uuid)
returns table (store_sales_count integer, store_sales_total numeric, my_sales_count integer, my_sales_total numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_start timestamptz;
begin
  if not app.is_store_member(p_store_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select date_trunc('day', now() at time zone st.timezone) at time zone st.timezone
    into v_start
  from public.stores st where st.id = p_store_id;

  return query
  select count(*)::integer, coalesce(sum(s.total), 0),
         (count(*) filter (where s.cashier_id = (select auth.uid())))::integer,
         coalesce(sum(s.total) filter (where s.cashier_id = (select auth.uid())), 0)
  from public.sales s
  where s.store_id = p_store_id and s.created_at >= v_start;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: only signed-in users (the role checks are inside).
-- -----------------------------------------------------------------------------
revoke execute on function
  app.check_report_range(timestamptz, timestamptz),
  app.sale_facts(uuid, timestamptz, timestamptz),
  app.return_facts(uuid, timestamptz, timestamptz),
  app.product_facts(uuid, timestamptz, timestamptz),
  public.report_summary(uuid, timestamptz, timestamptz),
  public.report_timeseries(uuid, timestamptz, timestamptz, text),
  public.report_products(uuid, timestamptz, timestamptz, text, integer),
  public.report_categories(uuid, timestamptz, timestamptz),
  public.report_payment_methods(uuid, timestamptz, timestamptz),
  public.report_cashiers(uuid, timestamptz, timestamptz),
  public.report_sales_export(uuid, timestamptz, timestamptz),
  public.report_sale_lines_export(uuid, timestamptz, timestamptz),
  public.dashboard_today(uuid)
from public, anon;

grant execute on function
  app.check_report_range(timestamptz, timestamptz),
  app.sale_facts(uuid, timestamptz, timestamptz),
  app.return_facts(uuid, timestamptz, timestamptz),
  app.product_facts(uuid, timestamptz, timestamptz),
  public.report_summary(uuid, timestamptz, timestamptz),
  public.report_timeseries(uuid, timestamptz, timestamptz, text),
  public.report_products(uuid, timestamptz, timestamptz, text, integer),
  public.report_categories(uuid, timestamptz, timestamptz),
  public.report_payment_methods(uuid, timestamptz, timestamptz),
  public.report_cashiers(uuid, timestamptz, timestamptz),
  public.report_sales_export(uuid, timestamptz, timestamptz),
  public.report_sale_lines_export(uuid, timestamptz, timestamptz),
  public.dashboard_today(uuid)
to authenticated, service_role;
