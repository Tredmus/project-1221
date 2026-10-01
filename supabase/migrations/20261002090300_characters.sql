-- =============================================================================
-- Countries and characters (GDD 4.1, 4.2)
-- =============================================================================
-- A character picks a country of birth at creation; the country sets their culture and
-- religion. Countries are their own list, apart from the map tiers (Venice, the Cumans
-- or the crusader states are countries without being kingdoms), each with a suggested
-- starting county. One character per account.
-- Characters are created by a function in phase 2 (starting attributes and placement are
-- still open), so apps cannot write them directly yet.

create table public.countries (
  id bigint generated always as identity primary key,
  name text not null unique check (length(trim(name)) between 1 and 80),
  culture_id text not null references public.cultures (id),
  religion_id text not null references public.religions (id),
  home_county_id bigint references public.counties (id) on delete set null,
  created_at timestamptz not null default now()
);

create index countries_culture_id_idx on public.countries (culture_id);
create index countries_religion_id_idx on public.countries (religion_id);
create index countries_home_county_id_idx on public.countries (home_county_id);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 24 and name = trim(name)),
  country_id bigint not null references public.countries (id),
  culture_id text not null references public.cultures (id),
  religion_id text not null references public.religions (id),
  -- Picked at creation: an art asset key and the generated coat of arms (GDD 12).
  portrait text,
  heraldry jsonb,
  level smallint not null default 1 check (level >= 1),
  experience integer not null default 0 check (experience >= 0),
  -- Attributes (GDD 4.2) and points not yet spent.
  strength smallint not null check (strength >= 0),
  dexterity smallint not null check (dexterity >= 0),
  agility smallint not null check (agility >= 0),
  vitality smallint not null check (vitality >= 0),
  wits smallint not null check (wits >= 0),
  attribute_points smallint not null default 0 check (attribute_points >= 0),
  created_at timestamptz not null default now()
);

create unique index characters_name_idx on public.characters (lower(name));
create index characters_country_id_idx on public.characters (country_id);
create index characters_culture_id_idx on public.characters (culture_id);
create index characters_religion_id_idx on public.characters (religion_id);

-- The caller's character, for policies and functions.
create function private.my_character_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.characters where account_id = (select auth.uid());
$$;

alter table public.countries enable row level security;
alter table public.characters enable row level security;

create policy "Anyone reads countries" on public.countries for select to anon, authenticated using (true);
create policy "Admins add countries" on public.countries for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit countries" on public.countries for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete countries" on public.countries for delete to authenticated using ((select private.is_admin()));

create policy "Players see characters" on public.characters for select to authenticated using (true);

grant select on public.countries to anon, authenticated;
grant insert, update, delete on public.countries to authenticated;
grant select on public.characters to authenticated;

-- Functions are callable only where granted below.
revoke all on all functions in schema public, private from public;
grant execute on function private.my_character_id() to authenticated, service_role;
