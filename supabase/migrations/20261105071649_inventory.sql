-- =============================================================================
-- Phase 4: inventory, store time zone and activity log tweaks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stores.timezone: IANA name validated against the zones Postgres knows.
-- (A CHECK constraint cannot query pg_timezone_names, so a trigger does it.)
-- -----------------------------------------------------------------------------
create function app.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger stores_validate_timezone
  before insert or update of timezone on public.stores
  for each row execute function app.validate_timezone();

-- Owners/admins may change it (RLS policy stores_update_manager already applies).
grant update (timezone) on public.stores to authenticated;

-- -----------------------------------------------------------------------------
-- Activity log: is_low_stock is derived from stock, so a sale must not show up
-- as a product edit. Same function as before plus 'is_low_stock' in the noise.
-- -----------------------------------------------------------------------------
create or replace function app.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_noise text[] := array['updated_at', 'stock', 'is_low_stock', 'last_sale_number'];
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

-- -----------------------------------------------------------------------------
-- create_store now also takes the time zone. The signature changes, so the old
-- function is dropped and recreated (same checks, same grants).
-- -----------------------------------------------------------------------------
drop function public.create_store(text, text, numeric, boolean);

create function public.create_store(
  p_name text,
  p_currency text default 'USD',
  p_tax_rate numeric default 0,
  p_prices_include_tax boolean default true,
  p_timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(p_name);
  v_currency text := upper(trim(p_currency));
  v_timezone text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_base text;
  v_store_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_name is null or length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'invalid_store_name' using errcode = '22023';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  if p_tax_rate is null or p_tax_rate < 0 or p_tax_rate >= 1 or p_tax_rate <> round(p_tax_rate, 4) then
    raise exception 'invalid_tax_rate' using errcode = '22023';
  end if;
  -- invalid time zones are rejected by app.validate_timezone() on insert

  v_base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 40);
  if v_base = '' then
    v_base := 'store';
  end if;

  insert into public.stores (name, slug, currency, tax_rate, prices_include_tax, timezone, created_by)
  values (
    v_name,
    v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
    v_currency,
    p_tax_rate,
    coalesce(p_prices_include_tax, true),
    v_timezone,
    v_uid
  )
  returning id into v_store_id;

  insert into public.store_members (store_id, user_id, role)
  values (v_store_id, v_uid, 'owner');

  return v_store_id;
end;
$$;

revoke execute on function public.create_store(text, text, numeric, boolean, text) from public, anon;
grant execute on function public.create_store(text, text, numeric, boolean, text) to authenticated, service_role;
