-- =============================================================================
-- Foundation: privilege defaults, helper schema, accounts, profiles, admin role
-- =============================================================================
--
-- Conventions used across all migrations:
--   * Every table has RLS enabled and explicit grants. Nothing is exposed by default.
--   * Apps read through RLS policies. Writes that must stay consistent (map topology,
--     clans, later elections and the economy) go through security-definer functions.
--   * Helper functions live in the `private` schema, which the Data API does not expose.
--   * Functions raise errors with a stable key in HINT (e.g. 'clan_name_taken'); the apps
--     translate it with errors.<key> from @1221/shared.
--   * The admin role is checked in the database (private.is_admin), never only in an app.

-- Match hosted projects that have "Automatically expose new tables" turned off, so local
-- and hosted environments behave the same. The service role keeps Supabase's defaults.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Raises an error the apps can translate: the key goes in HINT.
create function private.fail(key text, message text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', coalesce(message, key) using hint = key, errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Accounts and profiles
-- -----------------------------------------------------------------------------
-- The account is the Supabase Auth user (auth.users). Every account gets a profile row
-- for app-side settings; the in-game identity is the character (one per account).

create type public.app_role as enum ('admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  locale text check (locale in ('en', 'bg')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

-- First line of every admin-only function.
create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    perform private.fail('not_admin', 'Only admins can do this');
  end if;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

create policy "Users see their own profile; admins see all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy "Users edit their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Roles are granted with SQL by the project owner (see README), never from an app.
create policy "Users see their own roles; admins see all"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

grant select on public.profiles to authenticated;
grant update (locale) on public.profiles to authenticated;
grant select on public.user_roles to authenticated;

-- Functions are callable only where granted below.
revoke all on all functions in schema public, private from public;
grant execute on function private.is_admin() to anon, authenticated, service_role;
