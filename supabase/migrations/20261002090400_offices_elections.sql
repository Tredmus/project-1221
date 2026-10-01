-- =============================================================================
-- Offices and elections: skeleton (GDD 7)
-- =============================================================================
-- Mayors run counties, dukes duchies and kings kingdoms; all are elected (GDD 7.1, 7.2).
-- NPCs hold every office until players replace them: such an office has no character
-- holder, only an NPC name. What offices can do and how voting works (who may vote,
-- account-age gates, terms) is still open (GDD 7.3), so there are no player functions
-- yet. Votes are visible only to the voter and admins until that is decided.

create type public.office_kind as enum ('mayor', 'duke', 'king');
create type public.election_status as enum ('scheduled', 'open', 'closed');

create table public.offices (
  id bigint generated always as identity primary key,
  kind public.office_kind not null,
  county_id bigint references public.counties (id) on delete cascade,
  duchy_id bigint references public.duchies (id) on delete cascade,
  kingdom_id bigint references public.kingdoms (id) on delete cascade,
  holder_character_id uuid references public.characters (id) on delete set null,
  npc_holder_name text check (npc_holder_name is null or length(trim(npc_holder_name)) between 1 and 80),
  holder_since timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'mayor') = (county_id is not null)),
  check ((kind = 'duke') = (duchy_id is not null)),
  check ((kind = 'king') = (kingdom_id is not null)),
  check (holder_character_id is null or npc_holder_name is null)
);

create unique index offices_county_id_idx on public.offices (county_id);
create unique index offices_duchy_id_idx on public.offices (duchy_id);
create unique index offices_kingdom_id_idx on public.offices (kingdom_id);
create index offices_holder_character_id_idx on public.offices (holder_character_id);

create table public.elections (
  id bigint generated always as identity primary key,
  office_id bigint not null references public.offices (id) on delete cascade,
  status public.election_status not null default 'scheduled',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  winner_character_id uuid references public.characters (id) on delete set null,
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create index elections_office_id_idx on public.elections (office_id);
create index elections_winner_character_id_idx on public.elections (winner_character_id);

create table public.election_candidates (
  election_id bigint not null references public.elections (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (election_id, character_id)
);

create index election_candidates_character_id_idx on public.election_candidates (character_id);

create table public.election_votes (
  election_id bigint not null,
  voter_character_id uuid not null references public.characters (id) on delete cascade,
  candidate_character_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (election_id, voter_character_id),
  foreign key (election_id, candidate_character_id)
    references public.election_candidates (election_id, character_id) on delete cascade
);

create index election_votes_voter_character_id_idx on public.election_votes (voter_character_id);
create index election_votes_candidate_idx on public.election_votes (election_id, candidate_character_id);

alter table public.offices enable row level security;
alter table public.elections enable row level security;
alter table public.election_candidates enable row level security;
alter table public.election_votes enable row level security;

create policy "Anyone reads offices" on public.offices for select to anon, authenticated using (true);
create policy "Anyone reads elections" on public.elections for select to anon, authenticated using (true);
create policy "Anyone reads candidates" on public.election_candidates for select to anon, authenticated using (true);
create policy "Voters see their own vote; admins see all" on public.election_votes for select to authenticated
  using (voter_character_id = (select private.my_character_id()) or (select private.is_admin()));

-- Admins set offices and elections up by hand until the rules exist.
create policy "Admins add offices" on public.offices for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit offices" on public.offices for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete offices" on public.offices for delete to authenticated using ((select private.is_admin()));
create policy "Admins add elections" on public.elections for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit elections" on public.elections for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete elections" on public.elections for delete to authenticated using ((select private.is_admin()));

grant select on public.offices, public.elections, public.election_candidates to anon, authenticated;
grant select on public.election_votes to authenticated;
grant insert, update, delete on public.offices, public.elections to authenticated;
