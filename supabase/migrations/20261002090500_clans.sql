-- =============================================================================
-- Clans v1 (GDD 8)
-- =============================================================================
-- A player creates a clan and leads it. The leader invites (the invitee accepts or
-- declines), kicks, and hands leadership on. Members leave freely; the leader must hand
-- over first, unless they are the last member, which disbands the clan. One clan per
-- character, names unique. All changes go through the functions below.

create table public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 32 and name = trim(name)),
  leader_character_id uuid not null references public.characters (id),
  created_at timestamptz not null default now()
);

create unique index clans_name_idx on public.clans (lower(name));
create index clans_leader_character_id_idx on public.clans (leader_character_id);

create table public.clan_members (
  character_id uuid primary key references public.characters (id) on delete cascade,
  clan_id uuid not null references public.clans (id) on delete cascade,
  joined_at timestamptz not null default now()
);

create index clan_members_clan_id_idx on public.clan_members (clan_id);

create table public.clan_invites (
  clan_id uuid not null references public.clans (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  invited_by uuid references public.characters (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (clan_id, character_id)
);

create index clan_invites_character_id_idx on public.clan_invites (character_id);
create index clan_invites_invited_by_idx on public.clan_invites (invited_by);

create function private.my_clan_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clan_id from public.clan_members where character_id = private.my_character_id();
$$;

-- The caller's character, or the no_character error.
create function private.require_character()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.my_character_id();
begin
  if v_id is null then
    perform private.fail('no_character', 'Create a character first');
  end if;
  return v_id;
end;
$$;

-- The clan the caller leads (locked for the change), or the not_clan_leader error.
create function private.require_clan_leader(p_character_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan uuid;
begin
  select id into v_clan from public.clans where leader_character_id = p_character_id for update;
  if v_clan is null then
    perform private.fail('not_clan_leader', 'Only the clan leader can do this');
  end if;
  return v_clan;
end;
$$;

create function public.create_clan(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_character();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_clan uuid;
begin
  if exists (select 1 from public.clan_members where character_id = v_me) then
    perform private.fail('already_in_clan', 'Leave your clan first');
  end if;
  if char_length(v_name) not between 3 and 32 then
    perform private.fail('clan_name_invalid', 'A clan name has 3 to 32 characters');
  end if;
  if exists (select 1 from public.clans where lower(name) = lower(v_name)) then
    perform private.fail('clan_name_taken', 'That name is taken');
  end if;

  insert into public.clans (name, leader_character_id) values (v_name, v_me) returning id into v_clan;
  insert into public.clan_members (character_id, clan_id) values (v_me, v_clan);
  delete from public.clan_invites where character_id = v_me;
  return v_clan;
end;
$$;

create function public.invite_to_clan(p_character_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_character();
  v_clan uuid := private.require_clan_leader(v_me);
begin
  if not exists (select 1 from public.characters where id = p_character_id) then
    perform private.fail('character_not_found');
  end if;
  if exists (select 1 from public.clan_members where character_id = p_character_id) then
    perform private.fail('target_in_clan', 'They are already in a clan');
  end if;
  if exists (select 1 from public.clan_invites where clan_id = v_clan and character_id = p_character_id) then
    perform private.fail('already_invited');
  end if;
  insert into public.clan_invites (clan_id, character_id, invited_by) values (v_clan, p_character_id, v_me);
end;
$$;

create function public.cancel_clan_invite(p_character_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan uuid := private.require_clan_leader(private.require_character());
begin
  delete from public.clan_invites where clan_id = v_clan and character_id = p_character_id;
  if not found then
    perform private.fail('invite_not_found');
  end if;
end;
$$;

create function public.accept_clan_invite(p_clan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_character();
begin
  perform 1 from public.clans where id = p_clan_id for update;
  if not exists (select 1 from public.clan_invites where clan_id = p_clan_id and character_id = v_me) then
    perform private.fail('invite_not_found');
  end if;
  if exists (select 1 from public.clan_members where character_id = v_me) then
    perform private.fail('already_in_clan', 'Leave your clan first');
  end if;
  insert into public.clan_members (character_id, clan_id) values (v_me, p_clan_id);
  delete from public.clan_invites where character_id = v_me;
end;
$$;

create function public.decline_clan_invite(p_clan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_character();
begin
  delete from public.clan_invites where clan_id = p_clan_id and character_id = v_me;
  if not found then
    perform private.fail('invite_not_found');
  end if;
end;
$$;

create function public.kick_from_clan(p_character_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_character();
  v_clan uuid := private.require_clan_leader(v_me);
begin
  if p_character_id = v_me then
    perform private.fail('cannot_kick_self', 'Hand over leadership or leave instead');
  end if;
  delete from public.clan_members where clan_id = v_clan and character_id = p_character_id;
  if not found then
    perform private.fail('not_clan_member');
  end if;
end;
$$;

create function public.leave_clan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_character();
  v_clan uuid;
  v_leader uuid;
begin
  select m.clan_id, c.leader_character_id into v_clan, v_leader
  from public.clan_members m join public.clans c on c.id = m.clan_id
  where m.character_id = v_me
  for update of c;
  if v_clan is null then
    perform private.fail('not_in_clan');
  end if;

  if v_leader = v_me then
    if exists (select 1 from public.clan_members where clan_id = v_clan and character_id <> v_me) then
      perform private.fail('leader_must_hand_over', 'Hand leadership to another member before leaving');
    end if;
    delete from public.clans where id = v_clan;
  else
    delete from public.clan_members where character_id = v_me;
  end if;
end;
$$;

create function public.transfer_clan_leadership(p_character_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_character();
  v_clan uuid := private.require_clan_leader(v_me);
begin
  if p_character_id = v_me
     or not exists (select 1 from public.clan_members where clan_id = v_clan and character_id = p_character_id) then
    perform private.fail('not_clan_member');
  end if;
  update public.clans set leader_character_id = p_character_id where id = v_clan;
end;
$$;

-- When a leader's character is deleted (account deletion), the longest-serving member
-- takes over; a clan with nobody left is disbanded.
create function private.handle_leader_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan uuid;
  v_next uuid;
begin
  for v_clan in select id from public.clans where leader_character_id = old.id loop
    -- Members deleted earlier in the same statement are already gone from characters.
    select m.character_id into v_next
    from public.clan_members m join public.characters c on c.id = m.character_id
    where m.clan_id = v_clan and m.character_id <> old.id
    order by m.joined_at, m.character_id
    limit 1;
    if v_next is null then
      delete from public.clans where id = v_clan;
    else
      update public.clans set leader_character_id = v_next where id = v_clan;
    end if;
  end loop;
  return old;
end;
$$;

create trigger characters_handle_leader_deleted
  before delete on public.characters
  for each row execute function private.handle_leader_deleted();

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_invites enable row level security;

create policy "Players see clans" on public.clans for select to authenticated using (true);
create policy "Players see clan members" on public.clan_members for select to authenticated using (true);
create policy "Invitees and the clan see invites" on public.clan_invites for select to authenticated
  using (character_id = (select private.my_character_id()) or clan_id = (select private.my_clan_id()));

grant select on public.clans, public.clan_members, public.clan_invites to authenticated;

-- Functions are callable only where granted below.
revoke all on all functions in schema public, private from public;
grant execute on function private.my_clan_id() to authenticated, service_role;
grant execute on function public.create_clan(text) to authenticated;
grant execute on function public.invite_to_clan(uuid) to authenticated;
grant execute on function public.cancel_clan_invite(uuid) to authenticated;
grant execute on function public.accept_clan_invite(uuid) to authenticated;
grant execute on function public.decline_clan_invite(uuid) to authenticated;
grant execute on function public.kick_from_clan(uuid) to authenticated;
grant execute on function public.leave_clan() to authenticated;
grant execute on function public.transfer_clan_leadership(uuid) to authenticated;
