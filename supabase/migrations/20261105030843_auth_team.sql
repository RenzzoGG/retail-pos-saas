-- =============================================================================
-- Phase 3: onboarding, invitations and team management.
--
-- Rule decided in phase 3: only OWNERS manage admins. Admins may invite,
-- change and remove CASHIERS only (never admins or owners).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles.email: copied from auth.users (not exposed to clients) so the team
-- page can show teammates' emails. Clients cannot write it (no column grant).
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), lower(new.email));
  return new;
end;
$$;

create function app.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function app.handle_user_email_change();

update public.profiles p set email = lower(u.email) from auth.users u where u.id = p.id;

-- -----------------------------------------------------------------------------
-- Who may manage a membership/invitation with a given role?
--   owner -> any role;  admin -> only 'cashier';  cashier -> nothing.
-- Same safety properties as the phase-2 helpers (definer, empty search_path,
-- only answers about the caller, unexposed schema).
-- -----------------------------------------------------------------------------
create function app.can_manage_role(p_store_id uuid, p_role public.store_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_store_role(p_store_id, array['owner']::public.store_role[])
      or (p_role = 'cashier' and app.has_store_role(p_store_id, array['admin']::public.store_role[]));
$$;

revoke execute on function app.can_manage_role(uuid, public.store_role) from public, anon;
grant execute on function app.can_manage_role(uuid, public.store_role) to authenticated, service_role;

-- store_members: USING checks the CURRENT row (whom you touch), WITH CHECK the
-- NEW row (what you turn it into). An admin can neither touch an admin nor
-- turn a cashier into an admin.
drop policy store_members_insert_manager on public.store_members;
drop policy store_members_update_manager on public.store_members;
drop policy store_members_delete_manager on public.store_members;

create policy store_members_insert_by_role on public.store_members
  for insert to authenticated
  with check (app.can_manage_role(store_id, role));

create policy store_members_update_by_role on public.store_members
  for update to authenticated
  using (app.can_manage_role(store_id, role))
  with check (app.can_manage_role(store_id, role));

create policy store_members_delete_by_role on public.store_members
  for delete to authenticated
  using (app.can_manage_role(store_id, role));

-- invitations: owner invites admins or cashiers; admin only cashiers.
drop policy invitations_insert_manager on public.invitations;
drop policy invitations_delete_manager on public.invitations;

create policy invitations_insert_by_role on public.invitations
  for insert to authenticated
  with check (app.can_manage_role(store_id, role));

create policy invitations_delete_by_role on public.invitations
  for delete to authenticated
  using (app.can_manage_role(store_id, role));

-- -----------------------------------------------------------------------------
-- Token hashing. The app generates a random token, emails it, and stores only
-- this SHA-256 hash: a database leak does not expose usable invitation links.
-- -----------------------------------------------------------------------------
create function app.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

revoke execute on function app.hash_token(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_store: store + its tax/currency settings + owner membership, atomically.
-- Any signed-in user may create a store; they become its owner.
-- -----------------------------------------------------------------------------
create function public.create_store(
  p_name text,
  p_currency text default 'USD',
  p_tax_rate numeric default 0,
  p_prices_include_tax boolean default true
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

  -- URL-friendly slug + random suffix (names are not unique, slugs are).
  v_base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 40);
  if v_base = '' then
    v_base := 'store';
  end if;

  insert into public.stores (name, slug, currency, tax_rate, prices_include_tax, created_by)
  values (
    v_name,
    v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
    v_currency,
    p_tax_rate,
    coalesce(p_prices_include_tax, true),
    v_uid
  )
  returning id into v_store_id;

  insert into public.store_members (store_id, user_id, role)
  values (v_store_id, v_uid, 'owner');

  return v_store_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- invitation_preview: what the invite page shows before accepting. Knowing the
-- token (it was emailed to you) is what grants access to this summary.
-- -----------------------------------------------------------------------------
create function public.invitation_preview(p_token text)
returns table (
  store_name text,
  role public.store_role,
  email text,
  status text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  return query
  select s.name,
         i.role,
         i.email,
         case
           when i.accepted_at is not null then 'accepted'
           when i.expires_at <= now() then 'expired'
           else 'pending'
         end,
         i.expires_at
  from public.invitations i
  join public.stores s on s.id = i.store_id
  where i.token_hash = app.hash_token(p_token);
end;
$$;

-- -----------------------------------------------------------------------------
-- accept_invitation: validates the token, expiry, single use and that the
-- invitation was sent to the signed-in user's email; then creates the
-- membership. Returns the store id.
-- -----------------------------------------------------------------------------
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) < 20 then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;

  select * into v_inv
  from public.invitations i
  where i.token_hash = app.hash_token(p_token)
  for update;

  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation_already_used' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = '22023';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.store_members m
    where m.store_id = v_inv.store_id and m.user_id = v_uid
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.store_members (store_id, user_id, role)
  values (v_inv.store_id, v_uid, v_inv.role);

  update public.invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  return v_inv.store_id;
end;
$$;

revoke execute on function public.create_store(text, text, numeric, boolean) from public, anon;
revoke execute on function public.invitation_preview(text) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.create_store(text, text, numeric, boolean) to authenticated, service_role;
grant execute on function public.invitation_preview(text) to authenticated, service_role;
grant execute on function public.accept_invitation(text) to authenticated, service_role;
