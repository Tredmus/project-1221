-- =============================================================================
-- Cultures and religions (GDD 3.4, 3.5)
-- =============================================================================
-- Reference data with stable text ids that game code can name (culture-specific recipes,
-- faith rules). Display names are English here; the apps translate by id.
-- Draft lists: the 12 named cultures (no "Others" until the list is final) and the
-- faiths of GDD 3.5, with the heresies and pagan faiths as separate religions.

create table public.cultures (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) between 1 and 60),
  sort smallint not null default 0
);

create table public.religions (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) between 1 and 60),
  sort smallint not null default 0
);

insert into public.cultures (id, name, sort) values
  ('iberian', 'Iberian', 1),
  ('frankish', 'Frankish', 2),
  ('greek', 'Greek', 3),
  ('south_slavic', 'South Slavic', 4),
  ('hungarian', 'Hungarian', 5),
  ('italian', 'Italian', 6),
  ('german', 'German', 7),
  ('anglo_norman', 'Anglo-Norman', 8),
  ('steppe', 'Steppe', 9),
  ('turkic_persian', 'Turkic-Persian', 10),
  ('arab', 'Arab', 11),
  ('armenian', 'Armenian', 12);

insert into public.religions (id, name, sort) values
  ('catholic', 'Catholic', 1),
  ('orthodox', 'Orthodox', 2),
  ('sunni', 'Sunni Islam', 3),
  ('nizari', 'Nizari Ismaili', 4),
  ('cathar', 'Cathar', 5),
  ('bogomil', 'Bogomil', 6),
  ('baltic_pagan', 'Baltic pagan', 7),
  ('tengri', 'Tengri', 8);

alter table public.cultures enable row level security;
alter table public.religions enable row level security;

create policy "Anyone reads cultures" on public.cultures for select to anon, authenticated using (true);
create policy "Admins add cultures" on public.cultures for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit cultures" on public.cultures for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete cultures" on public.cultures for delete to authenticated using ((select private.is_admin()));

create policy "Anyone reads religions" on public.religions for select to anon, authenticated using (true);
create policy "Admins add religions" on public.religions for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit religions" on public.religions for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete religions" on public.religions for delete to authenticated using ((select private.is_admin()));

grant select on public.cultures, public.religions to anon, authenticated;
grant insert, update, delete on public.cultures, public.religions to authenticated;
