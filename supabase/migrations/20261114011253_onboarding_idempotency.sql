-- =============================================================================
-- Onboarding idempotency: a double submit of "Create store" must not create two
-- stores.
--
-- The onboarding form generates a UUID once per page view and sends it with
-- every submit. create_store() stores it in stores.idempotency_key (unique per
-- creator, see *_onboarding_idempotency_schema.sql) and, when the same user
-- repeats the key, returns the store created the first time instead of
-- inserting a new one. Same pattern as create_sale().
--
-- Concurrent submits with the same key are serialized with a transaction-level
-- advisory lock; the unique constraint is the last line of defense.
-- The key is optional so SQL callers (seed, tests) keep working without one.
-- =============================================================================

drop function public.create_store(text, text, numeric, boolean, text);

create function public.create_store(
  p_name text,
  p_currency text default 'USD',
  p_tax_rate numeric default 0,
  p_prices_include_tax boolean default true,
  p_timezone text default 'UTC',
  p_idempotency_key uuid default null
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

  if p_idempotency_key is not null then
    -- Same user + same key: one transaction at a time. The key is scoped to
    -- the user, so another user's key can never return someone else's store.
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':create_store:' || p_idempotency_key::text, 0));
    select s.id into v_store_id
    from public.stores s
    where s.created_by = v_uid and s.idempotency_key = p_idempotency_key;
    if v_store_id is not null then
      return v_store_id;
    end if;
  end if;

  v_base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 40);
  if v_base = '' then
    v_base := 'store';
  end if;

  insert into public.stores (name, slug, currency, tax_rate, prices_include_tax, timezone, created_by, idempotency_key)
  values (
    v_name,
    v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
    v_currency,
    p_tax_rate,
    coalesce(p_prices_include_tax, true),
    v_timezone,
    v_uid,
    p_idempotency_key
  )
  returning id into v_store_id;

  insert into public.store_members (store_id, user_id, role)
  values (v_store_id, v_uid, 'owner');

  return v_store_id;
end;
$$;

revoke execute on function public.create_store(text, text, numeric, boolean, text, uuid) from public, anon;
grant execute on function public.create_store(text, text, numeric, boolean, text, uuid) to authenticated, service_role;
