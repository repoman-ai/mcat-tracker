-- Optional private sign-in usernames and immutable PIN credential salts.
-- This schema is intentionally NOT exposed through the Supabase Data API.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.account_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_email text not null,
  login_username text,
  credential_salt text not null,
  credential_version integer not null default 2,
  migration_state text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  constraint account_email_normalized check (account_email = lower(btrim(account_email)) and position('@' in account_email) > 1),
  constraint login_username_normalized check (
    login_username is null or (
      login_username = lower(btrim(login_username))
      and char_length(login_username) between 3 and 32
      and login_username ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$'
      and login_username !~ '[._-]{2}'
    )
  ),
  constraint credential_salt_shape check (credential_salt ~ '^[A-Za-z0-9_-]{43}$'),
  constraint credential_version_supported check (credential_version = 2),
  constraint migration_state_valid check (migration_state in ('pending', 'active'))
);

create unique index if not exists account_credentials_email_key
  on private.account_credentials (account_email);
create unique index if not exists account_credentials_username_key
  on private.account_credentials (login_username)
  where login_username is not null;

create table if not exists private.edge_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  updated_at timestamptz not null default now()
);
create index if not exists edge_rate_limits_updated_at_idx
  on private.edge_rate_limits (updated_at);

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

create or replace function private.prevent_credential_salt_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.credential_salt is distinct from old.credential_salt
     or new.credential_version is distinct from old.credential_version then
    raise exception 'account credential salt and version are immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists account_credentials_immutable_salt on private.account_credentials;
create trigger account_credentials_immutable_salt
before update on private.account_credentials
for each row execute function private.prevent_credential_salt_change();

create or replace function private.sync_account_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update private.account_credentials
       set account_email = lower(btrim(new.email)), updated_at = now()
     where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_private_account_email on auth.users;
create trigger sync_private_account_email
after update of email on auth.users
for each row execute function private.sync_account_email_from_auth();

-- The wrappers below live in an exposed schema because Edge Functions use
-- PostgREST with a secret/service-role key. No browser role can execute them.
create or replace function public.server_resolve_account_identifier(p_identifier text)
returns table (
  user_id uuid,
  account_email text,
  login_username text,
  credential_salt text,
  credential_version integer,
  migration_state text
)
language sql
security definer
stable
set search_path = ''
as $$
  select c.user_id, c.account_email, c.login_username, c.credential_salt,
         c.credential_version, c.migration_state
    from private.account_credentials c
   where c.account_email = lower(btrim(p_identifier))
      or c.login_username = lower(btrim(p_identifier))
   limit 1;
$$;

create or replace function public.server_account_credential_status(p_user_id uuid, p_email text)
returns table (
  login_username text,
  credential_salt text,
  credential_version integer,
  migration_state text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.account_credentials
     set account_email = lower(btrim(p_email)), updated_at = now()
   where user_id = p_user_id and account_email is distinct from lower(btrim(p_email));
  return query
    select c.login_username, c.credential_salt, c.credential_version, c.migration_state
      from private.account_credentials c where c.user_id = p_user_id;
end;
$$;

create or replace function public.server_begin_account_migration(
  p_user_id uuid,
  p_email text,
  p_login_username text
)
returns table (
  login_username text,
  credential_salt text,
  credential_version integer,
  migration_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(btrim(p_login_username));
begin
  insert into private.account_credentials (
    user_id, account_email, login_username, credential_salt, credential_version, migration_state
  ) values (
    p_user_id,
    lower(btrim(p_email)),
    normalized_username,
    rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='),
    2,
    'pending'
  )
  on conflict (user_id) do update
    set account_email = excluded.account_email,
        login_username = excluded.login_username,
        updated_at = now();

  return query
    select c.login_username, c.credential_salt, c.credential_version, c.migration_state
      from private.account_credentials c where c.user_id = p_user_id;
end;
$$;

create or replace function public.server_set_account_username(p_user_id uuid, p_login_username text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.account_credentials
     set login_username = case when p_login_username is null then null else lower(btrim(p_login_username)) end,
         updated_at = now()
   where user_id = p_user_id;
$$;

create or replace function public.server_activate_account_credential(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.account_credentials
     set migration_state = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
   where user_id = p_user_id;
$$;

create or replace function public.server_consume_edge_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_attempts integer;
begin
  delete from private.edge_rate_limits
   where updated_at < now() - interval '1 day';
  insert into private.edge_rate_limits(rate_key, window_started_at, attempts, updated_at)
  values (p_rate_key, now(), 1, now())
  on conflict (rate_key) do update set
    attempts = case
      when private.edge_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else private.edge_rate_limits.attempts + 1
    end,
    window_started_at = case
      when private.edge_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else private.edge_rate_limits.window_started_at
    end,
    updated_at = now()
  returning attempts into next_attempts;
  return next_attempts <= p_limit;
end;
$$;

revoke all on function public.server_resolve_account_identifier(text) from public, anon, authenticated;
revoke all on function public.server_account_credential_status(uuid, text) from public, anon, authenticated;
revoke all on function public.server_begin_account_migration(uuid, text, text) from public, anon, authenticated;
revoke all on function public.server_set_account_username(uuid, text) from public, anon, authenticated;
revoke all on function public.server_activate_account_credential(uuid) from public, anon, authenticated;
revoke all on function public.server_consume_edge_rate_limit(text, integer, integer) from public, anon, authenticated;

grant execute on function public.server_resolve_account_identifier(text) to service_role;
grant execute on function public.server_account_credential_status(uuid, text) to service_role;
grant execute on function public.server_begin_account_migration(uuid, text, text) to service_role;
grant execute on function public.server_set_account_username(uuid, text) to service_role;
grant execute on function public.server_activate_account_credential(uuid) to service_role;
grant execute on function public.server_consume_edge_rate_limit(text, integer, integer) to service_role;

-- Keep internal storage out of the default Data API permission surface even if
-- future objects are added to the private schema.
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
