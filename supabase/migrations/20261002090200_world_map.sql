-- =============================================================================
-- World map (GDD 3.1, 13.1)
-- =============================================================================
-- Tiers: empire > kingdom > duchy > county > node. Only counties are drawn; duchy,
-- kingdom and empire borders are computed from the counties they contain. Every link up
-- the hierarchy is optional while the map is being drawn.
--
-- County shapes form one shared planar graph, so neighbors can never drift apart:
--   border_points  vertices as real longitude/latitude
--   border_edges   straight segments between two points, naming the county on each side:
--                  left/right when walking from point_a to point_b (longitude east,
--                  latitude north); null means outside (the sea, or not drawn yet)
-- Moving a point moves it for every county that uses it. A county's outline is assembled
-- from the edges that name it (@1221/game-core). Points and edges are created and
-- removed only by the map_* functions below, which keep the graph consistent; admins
-- may move points directly.

create type public.node_type as enum (
  -- Main node types: the node that controls its county (GDD 3.1).
  'town', 'castle', 'mine', 'farm', 'monastery',
  -- Travel nodes: nobody controls them.
  'road', 'crossroads', 'ford', 'pass', 'forest'
);

create type public.biome as enum ('plains', 'forest', 'hills', 'mountains', 'steppe', 'marsh', 'coast', 'desert');

create function private.is_main_node_type(t public.node_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t in ('town', 'castle', 'mine', 'farm', 'monastery');
$$;

-- -----------------------------------------------------------------------------
-- Tiers
-- -----------------------------------------------------------------------------

create table public.empires (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.kingdoms (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 80),
  empire_id bigint references public.empires (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.duchies (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 80),
  kingdom_id bigint references public.kingdoms (id) on delete set null,
  -- One of its counties (GDD 3.1). Foreign key added below.
  main_county_id bigint,
  created_at timestamptz not null default now()
);

create table public.counties (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 80),
  duchy_id bigint references public.duchies (id) on delete set null,
  -- Whoever holds this node controls the county (GDD 3.1). Foreign key added below.
  main_node_id bigint,
  -- The people's culture and faith (for the mismatch rules in GDD 3.5 and 10).
  culture_id text references public.cultures (id),
  religion_id text references public.religions (id),
  created_at timestamptz not null default now()
);

alter table public.duchies
  add constraint duchies_main_county_id_fkey foreign key (main_county_id) references public.counties (id) on delete set null;

create table public.nodes (
  id bigint generated always as identity primary key,
  name text check (name is null or length(trim(name)) between 1 and 80),
  type public.node_type not null,
  biome public.biome not null,
  lon double precision not null check (lon between -180 and 180),
  lat double precision not null check (lat between -85 and 85),
  -- The county the node lies in; the editor assigns it from the county outlines.
  county_id bigint references public.counties (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.counties
  add constraint counties_main_node_id_fkey foreign key (main_node_id) references public.nodes (id) on delete set null;

-- Roads join two nodes. Stored once per pair, lowest id first.
create table public.roads (
  id bigint generated always as identity primary key,
  node_a bigint not null references public.nodes (id) on delete cascade,
  node_b bigint not null references public.nodes (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (node_a < node_b),
  unique (node_a, node_b)
);

create index kingdoms_empire_id_idx on public.kingdoms (empire_id);
create index duchies_kingdom_id_idx on public.duchies (kingdom_id);
create index duchies_main_county_id_idx on public.duchies (main_county_id);
create index counties_duchy_id_idx on public.counties (duchy_id);
create unique index counties_main_node_id_idx on public.counties (main_node_id);
create index counties_culture_id_idx on public.counties (culture_id);
create index counties_religion_id_idx on public.counties (religion_id);
create index nodes_county_id_idx on public.nodes (county_id);
create index roads_node_b_idx on public.roads (node_b);

-- -----------------------------------------------------------------------------
-- County borders: shared points and edges
-- -----------------------------------------------------------------------------

create table public.border_points (
  id bigint generated always as identity primary key,
  lon double precision not null check (lon between -180 and 180),
  lat double precision not null check (lat between -85 and 85)
);

create table public.border_edges (
  id bigint generated always as identity primary key,
  point_a bigint not null references public.border_points (id),
  point_b bigint not null references public.border_points (id),
  left_county_id bigint references public.counties (id) on delete set null,
  right_county_id bigint references public.counties (id) on delete set null,
  check (point_a <> point_b),
  check (left_county_id is null or right_county_id is null or left_county_id <> right_county_id)
);

create index border_edges_point_a_idx on public.border_edges (point_a);
create index border_edges_point_b_idx on public.border_edges (point_b);
create unique index border_edges_pair_idx on public.border_edges (least(point_a, point_b), greatest(point_a, point_b));
create index border_edges_left_county_id_idx on public.border_edges (left_county_id);
create index border_edges_right_county_id_idx on public.border_edges (right_county_id);

-- -----------------------------------------------------------------------------
-- Reference images under the editor (admin only)
-- -----------------------------------------------------------------------------
-- 'image': a picture in the map-references bucket, stretched over a lon/lat box in the
--          editor's Web Mercator view. 'tiles': an XYZ raster layer of an already
--          georeferenced map (Allmaps, MapWarper…), e.g. https://…/{z}/{x}/{y}.png

create table public.map_references (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('image', 'tiles')),
  storage_path text,
  tile_url text,
  west double precision,
  south double precision,
  east double precision,
  north double precision,
  opacity real not null default 0.6 check (opacity between 0 and 1),
  visible boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  check (
    (kind = 'image' and storage_path is not null
      and west < east and south < north and west >= -180 and east <= 180 and south >= -85 and north <= 85)
    or (kind = 'tiles' and tile_url ~ '^https://')
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('map-references', 'map-references', false, 52428800, array['image/png', 'image/jpeg', 'image/webp']);

create policy "Admins read map references"
  on storage.objects for select to authenticated
  using (bucket_id = 'map-references' and (select private.is_admin()));
create policy "Admins upload map references"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'map-references' and (select private.is_admin()));
create policy "Admins replace map references"
  on storage.objects for update to authenticated
  using (bucket_id = 'map-references' and (select private.is_admin()))
  with check (bucket_id = 'map-references' and (select private.is_admin()));
create policy "Admins delete map references"
  on storage.objects for delete to authenticated
  using (bucket_id = 'map-references' and (select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Main node and main county rules
-- -----------------------------------------------------------------------------

-- A county's main node is one of its own nodes, of a main type.
create function private.check_county_main_node()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.main_node_id is not null and not exists (
    select 1 from public.nodes n
    where n.id = new.main_node_id and n.county_id = new.id and private.is_main_node_type(n.type)
  ) then
    perform private.fail('main_node_invalid', 'The main node must be a town, castle, mine, farm or monastery inside the county');
  end if;
  return new;
end;
$$;

create trigger counties_check_main_node
  before insert or update of main_node_id on public.counties
  for each row execute function private.check_county_main_node();

-- Keeps main nodes valid as nodes change: a node that leaves its county or stops being a
-- main type stops being the main node, and a main-type node placed in a county without
-- a main node becomes it (only the main node has a main type).
create function private.sync_main_node()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    update public.counties set main_node_id = null
    where main_node_id = new.id
      and (id is distinct from new.county_id or not private.is_main_node_type(new.type));
  end if;
  if new.county_id is not null and private.is_main_node_type(new.type) then
    update public.counties set main_node_id = new.id
    where id = new.county_id and main_node_id is null;
  end if;
  return null;
end;
$$;

create trigger nodes_sync_main_node
  after insert or update of county_id, type on public.nodes
  for each row execute function private.sync_main_node();

-- A duchy's main county is one of its own counties.
create function private.check_duchy_main_county()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.main_county_id is not null and not exists (
    select 1 from public.counties c where c.id = new.main_county_id and c.duchy_id = new.id
  ) then
    perform private.fail('main_county_invalid', 'The main county must belong to the duchy');
  end if;
  return new;
end;
$$;

create trigger duchies_check_main_county
  before insert or update of main_county_id on public.duchies
  for each row execute function private.check_duchy_main_county();

-- A county that moves to another duchy stops being its old duchy's main county.
create function private.sync_main_county()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.duchies set main_county_id = null
  where main_county_id = new.id and id is distinct from new.duchy_id;
  return null;
end;
$$;

create trigger counties_sync_main_county
  after update of duchy_id on public.counties
  for each row execute function private.sync_main_county();

-- -----------------------------------------------------------------------------
-- Topology helpers
-- -----------------------------------------------------------------------------

-- Everything a map_* function changed, as full rows, for the editor to merge.
create function private.map_patch(
  p_points bigint[] default '{}',
  p_edges bigint[] default '{}',
  p_counties bigint[] default '{}',
  p_nodes bigint[] default '{}',
  p_roads bigint[] default '{}',
  d_points bigint[] default '{}',
  d_edges bigint[] default '{}',
  d_counties bigint[] default '{}',
  d_nodes bigint[] default '{}',
  d_roads bigint[] default '{}'
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'points', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.border_points t where t.id = any (p_points)), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.border_edges t where t.id = any (p_edges)), '[]'::jsonb),
    'counties', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.counties t where t.id = any (p_counties)), '[]'::jsonb),
    'nodes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.nodes t where t.id = any (p_nodes)), '[]'::jsonb),
    'roads', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.roads t where t.id = any (p_roads)), '[]'::jsonb),
    'deleted', jsonb_build_object(
      'points', to_jsonb(coalesce(d_points, '{}')),
      'edges', to_jsonb(coalesce(d_edges, '{}')),
      'counties', to_jsonb(coalesce(d_counties, '{}')),
      'nodes', to_jsonb(coalesce(d_nodes, '{}')),
      'roads', to_jsonb(coalesce(d_roads, '{}'))
    )
  );
$$;

-- Squared planar distance from (px, py) to the segment (x1, y1)-(x2, y2).
create function private.segment_distance(
  px double precision, py double precision,
  x1 double precision, y1 double precision, x2 double precision, y2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
    when s.t is null then (px - x1) ^ 2 + (py - y1) ^ 2
    else (px - (x1 + s.t * (x2 - x1))) ^ 2 + (py - (y1 + s.t * (y2 - y1))) ^ 2
  end
  from (
    select greatest(0, least(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / nullif((x2 - x1) ^ 2 + (y2 - y1) ^ 2, 0))) as t
  ) s;
$$;

-- Splits an edge at (lon, lat): the edge keeps its id from point_a to the new point, and
-- a new edge with the same counties runs on to point_b.
create function private.split_edge(
  p_edge_id bigint, p_lon double precision, p_lat double precision,
  out point_id bigint, out new_edge_id bigint
)
language plpgsql
set search_path = ''
as $$
declare
  e public.border_edges;
begin
  select * into e from public.border_edges where id = p_edge_id for update;
  if not found then
    perform private.fail('edge_not_found');
  end if;
  insert into public.border_points (lon, lat) values (p_lon, p_lat) returning id into point_id;
  update public.border_edges set point_b = point_id where id = e.id;
  insert into public.border_edges (point_a, point_b, left_county_id, right_county_id)
  values (point_id, e.point_b, e.left_county_id, e.right_county_id)
  returning id into new_edge_id;
end;
$$;

-- Removes the given points if no edge uses them any more. Returns the removed ids.
create function private.delete_orphan_points(p_ids bigint[])
returns bigint[]
language sql
set search_path = ''
as $$
  with removed as (
    delete from public.border_points p
    where p.id = any (p_ids)
      and not exists (select 1 from public.border_edges e where e.point_a = p.id or e.point_b = p.id)
    returning p.id
  )
  select coalesce(array_agg(id), '{}') from removed;
$$;

-- -----------------------------------------------------------------------------
-- Editor functions (admins only)
-- -----------------------------------------------------------------------------

-- Draws a county outline, or adds another ring (an island, an extension) to an existing
-- county when p_county_id is given. p_points lists the outline in order, each one of:
--   {"id": 12}                            an existing border point (shared with a neighbor)
--   {"lon": 25.6, "lat": 43.1}            a new point
--   {"edge": 34, "lon": 25.6, "lat": 43.1} a new point on an existing edge (splits it)
-- Segments that already exist are shared: this county takes their free side. A side that
-- already belongs to another county is an overlap and fails; a segment with this county
-- on both sides is dissolved (the ring extends the county).
create function public.map_create_county(p_points jsonb, p_name text default null, p_county_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_county bigint := p_county_id;
  v_ids bigint[] := '{}';
  v_item jsonb;
  v_id bigint;
  v_orig bigint;
  v_edge bigint;
  v_lon double precision;
  v_lat double precision;
  v_split record;
  v_lineage jsonb := '{}';
  v_n integer;
  v_area double precision;
  v_ccw boolean;
  v_on_left boolean;
  v_other bigint;
  v_points bigint[] := '{}';
  v_edges bigint[] := '{}';
  v_deleted_edges bigint[] := '{}';
  v_ends bigint[] := '{}';
  v_deleted_points bigint[];
  e public.border_edges;
  a bigint;
  b bigint;
begin
  perform private.require_admin();
  if p_points is null or jsonb_typeof(p_points) <> 'array' then
    perform private.fail('ring_invalid', 'Points must be a list');
  end if;

  if v_county is null then
    insert into public.counties (name) values (coalesce(nullif(trim(p_name), ''), 'New county'))
    returning id into v_county;
  elsif not exists (select 1 from public.counties where id = v_county) then
    perform private.fail('county_not_found');
  end if;

  for v_item in select value from jsonb_array_elements(p_points) loop
    if v_item ? 'id' then
      v_id := (v_item ->> 'id')::bigint;
      if not exists (select 1 from public.border_points where id = v_id) then
        perform private.fail('point_not_found');
      end if;
    else
      v_lon := (v_item ->> 'lon')::double precision;
      v_lat := (v_item ->> 'lat')::double precision;
      if v_lon is null or v_lat is null then
        perform private.fail('ring_invalid', 'A new point needs lon and lat');
      end if;
      if v_item ? 'edge' then
        -- An earlier point may already have split this edge: split the piece nearest to
        -- this point.
        v_orig := (v_item ->> 'edge')::bigint;
        select ce.id into v_edge
        from public.border_edges ce
        join public.border_points pa on pa.id = ce.point_a
        join public.border_points pb on pb.id = ce.point_b
        where ce.id = v_orig
           or ce.id in (select x::bigint from jsonb_array_elements_text(coalesce(v_lineage -> v_orig::text, '[]')) x)
        order by private.segment_distance(v_lon, v_lat, pa.lon, pa.lat, pb.lon, pb.lat)
        limit 1;
        if v_edge is null then
          perform private.fail('edge_not_found');
        end if;
        select * into v_split from private.split_edge(v_edge, v_lon, v_lat);
        v_lineage := jsonb_set(v_lineage, array[v_orig::text],
          coalesce(v_lineage -> v_orig::text, '[]') || to_jsonb(v_split.new_edge_id));
        v_edges := v_edges || v_edge || v_split.new_edge_id;
        v_id := v_split.point_id;
      else
        insert into public.border_points (lon, lat) values (v_lon, v_lat) returning id into v_id;
      end if;
    end if;
    v_points := v_points || v_id;
    if cardinality(v_ids) = 0 or v_ids[cardinality(v_ids)] <> v_id then
      v_ids := v_ids || v_id;
    end if;
  end loop;

  -- A closed ring may repeat its first point at the end.
  v_n := cardinality(v_ids);
  if v_n > 1 and v_ids[1] = v_ids[v_n] then
    v_ids := v_ids[1:v_n - 1];
    v_n := v_n - 1;
  end if;
  if v_n < 3 or (select count(distinct x) from unnest(v_ids) x) <> v_n then
    perform private.fail('ring_invalid', 'An outline needs at least 3 different points and may not cross itself at a point');
  end if;

  -- Orientation by the shoelace formula: counter-clockwise means the inside is on the left.
  select sum(pa.lon * pb.lat - pb.lon * pa.lat) into v_area
  from generate_subscripts(v_ids, 1) i
  join public.border_points pa on pa.id = v_ids[i]
  join public.border_points pb on pb.id = v_ids[(i % v_n) + 1];
  if v_area = 0 then
    perform private.fail('ring_invalid', 'The outline has no area');
  end if;
  v_ccw := v_area > 0;

  for i in 1..v_n loop
    a := v_ids[i];
    b := v_ids[(i % v_n) + 1];
    select * into e from public.border_edges
    where least(point_a, point_b) = least(a, b) and greatest(point_a, point_b) = greatest(a, b)
    for update;
    if not found then
      insert into public.border_edges (point_a, point_b, left_county_id, right_county_id)
      values (a, b, case when v_ccw then v_county end, case when not v_ccw then v_county end)
      returning id into v_id;
      v_edges := v_edges || v_id;
      continue;
    end if;

    -- The side of the stored edge that faces this county.
    v_on_left := (e.point_a = a) = v_ccw;
    if (v_on_left and e.left_county_id is not null) or (not v_on_left and e.right_county_id is not null) then
      perform private.fail('overlap', format('This border already has %s on that side',
        (select name from public.counties where id = case when v_on_left then e.left_county_id else e.right_county_id end)));
    end if;
    v_other := case when v_on_left then e.right_county_id else e.left_county_id end;
    if v_other = v_county then
      delete from public.border_edges where id = e.id;
      v_deleted_edges := v_deleted_edges || e.id;
      v_ends := v_ends || e.point_a || e.point_b;
    elsif v_on_left then
      update public.border_edges set left_county_id = v_county where id = e.id;
      v_edges := v_edges || e.id;
    else
      update public.border_edges set right_county_id = v_county where id = e.id;
      v_edges := v_edges || e.id;
    end if;
  end loop;

  v_deleted_points := private.delete_orphan_points(v_ends);
  return private.map_patch(
    p_points => v_points,
    p_edges => v_edges,
    p_counties => array[v_county],
    d_edges => v_deleted_edges,
    d_points => v_deleted_points
  );
end;
$$;

-- Adds a point in the middle of an edge (both counties get it).
create function public.map_split_edge(p_edge_id bigint, p_lon double precision, p_lat double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_split record;
begin
  perform private.require_admin();
  select * into v_split from private.split_edge(p_edge_id, p_lon, p_lat);
  return private.map_patch(p_points => array[v_split.point_id], p_edges => array[p_edge_id, v_split.new_edge_id]);
end;
$$;

-- Removes a point that sits between exactly two segments with the same counties on each
-- side; the two segments become one. Junctions (three or more counties) stay.
create function public.map_delete_point(p_point_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edges public.border_edges[];
  e1 public.border_edges;
  e2 public.border_edges;
  x bigint;
  y bigint;
  l1 bigint;
  r1 bigint;
  l2 bigint;
  r2 bigint;
begin
  perform private.require_admin();
  if not exists (select 1 from public.border_points where id = p_point_id) then
    perform private.fail('point_not_found');
  end if;

  select array_agg(e order by e.id) into v_edges
  from public.border_edges e
  where e.point_a = p_point_id or e.point_b = p_point_id;

  if v_edges is null then
    delete from public.border_points where id = p_point_id;
    return private.map_patch(d_points => array[p_point_id]);
  end if;
  if cardinality(v_edges) <> 2 then
    perform private.fail('point_is_junction', 'Three or more borders meet at this point');
  end if;

  -- Read both edges walking x -> point -> y.
  e1 := v_edges[1];
  e2 := v_edges[2];
  if e1.point_b = p_point_id then
    x := e1.point_a; l1 := e1.left_county_id; r1 := e1.right_county_id;
  else
    x := e1.point_b; l1 := e1.right_county_id; r1 := e1.left_county_id;
  end if;
  if e2.point_a = p_point_id then
    y := e2.point_b; l2 := e2.left_county_id; r2 := e2.right_county_id;
  else
    y := e2.point_a; l2 := e2.right_county_id; r2 := e2.left_county_id;
  end if;

  if l1 is distinct from l2 or r1 is distinct from r2 then
    perform private.fail('point_is_junction', 'Different counties meet at this point');
  end if;
  if x = y or exists (
    select 1 from public.border_edges
    where least(point_a, point_b) = least(x, y) and greatest(point_a, point_b) = greatest(x, y)
  ) then
    perform private.fail('ring_too_small', 'Removing this point would collapse an outline');
  end if;

  update public.border_edges
  set point_a = x, point_b = y, left_county_id = l1, right_county_id = r1
  where id = e1.id;
  delete from public.border_edges where id = e2.id;
  delete from public.border_points where id = p_point_id;

  return private.map_patch(p_edges => array[e1.id], d_edges => array[e2.id], d_points => array[p_point_id]);
end;
$$;

-- Glues one point onto another (snapping a dragged point onto a neighbor's point): every
-- segment of p_from moves to p_into. Segments that end up joining the same two points
-- are combined; a segment between the two points disappears.
create function public.map_merge_points(p_from bigint, p_into bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.border_edges;
  f public.border_edges;
  o bigint;
  l bigint;
  r bigint;
  fl bigint;
  fr bigint;
  v_edges bigint[] := '{}';
  v_deleted_edges bigint[] := '{}';
  v_ends bigint[] := '{}';
  v_deleted_points bigint[];
begin
  perform private.require_admin();
  if p_from = p_into then
    perform private.fail('merge_invalid', 'Pick two different points');
  end if;
  if (select count(*) from public.border_points where id in (p_from, p_into)) <> 2 then
    perform private.fail('point_not_found');
  end if;

  for e in select * from public.border_edges where point_a = p_from or point_b = p_from order by id loop
    o := case when e.point_a = p_from then e.point_b else e.point_a end;
    if o = p_into then
      delete from public.border_edges where id = e.id;
      v_deleted_edges := v_deleted_edges || e.id;
      continue;
    end if;

    -- Sides walking o -> p_from, which becomes o -> p_into.
    if e.point_a = o then
      l := e.left_county_id; r := e.right_county_id;
    else
      l := e.right_county_id; r := e.left_county_id;
    end if;

    select * into f from public.border_edges
    where least(point_a, point_b) = least(o, p_into) and greatest(point_a, point_b) = greatest(o, p_into)
    for update;
    if not found then
      update public.border_edges set point_a = o, point_b = p_into, left_county_id = l, right_county_id = r
      where id = e.id;
      v_edges := v_edges || e.id;
      continue;
    end if;

    if f.point_a = o then
      fl := f.left_county_id; fr := f.right_county_id;
    else
      fl := f.right_county_id; fr := f.left_county_id;
    end if;
    if (l is not null and fl is not null and l <> fl) or (r is not null and fr is not null and r <> fr) then
      perform private.fail('overlap', 'These borders belong to different counties on the same side');
    end if;
    l := coalesce(l, fl);
    r := coalesce(r, fr);
    delete from public.border_edges where id = e.id;
    v_deleted_edges := v_deleted_edges || e.id;
    if l is not distinct from r then
      delete from public.border_edges where id = f.id;
      v_deleted_edges := v_deleted_edges || f.id;
      v_ends := v_ends || o;
    else
      update public.border_edges set point_a = o, point_b = p_into, left_county_id = l, right_county_id = r
      where id = f.id;
      v_edges := v_edges || f.id;
    end if;
  end loop;

  delete from public.border_points where id = p_from;
  v_deleted_points := array[p_from] || private.delete_orphan_points(v_ends || p_into);

  return private.map_patch(
    p_points => array[p_into],
    p_edges => v_edges,
    d_edges => v_deleted_edges,
    d_points => v_deleted_points
  );
end;
$$;

-- Deletes a county. Its borders stay where a neighbor still uses them; its nodes stay,
-- without a county.
create function public.map_delete_county(p_county_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edges bigint[];
  v_deleted_edges bigint[];
  v_ends bigint[];
  v_nodes bigint[];
  v_deleted_points bigint[];
begin
  perform private.require_admin();
  if not exists (select 1 from public.counties where id = p_county_id) then
    perform private.fail('county_not_found');
  end if;

  with cleared as (
    update public.border_edges
    set left_county_id = nullif(left_county_id, p_county_id),
        right_county_id = nullif(right_county_id, p_county_id)
    where left_county_id = p_county_id or right_county_id = p_county_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_edges from cleared;

  with removed as (
    delete from public.border_edges
    where id = any (v_edges) and left_county_id is null and right_county_id is null
    returning id, point_a, point_b
  )
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(point_a), '{}') || coalesce(array_agg(point_b), '{}')
  into v_deleted_edges, v_ends
  from removed;

  select coalesce(array_agg(id), '{}') into v_nodes from public.nodes where county_id = p_county_id;
  delete from public.counties where id = p_county_id;
  v_deleted_points := private.delete_orphan_points(v_ends);

  return private.map_patch(
    p_edges => v_edges,
    p_nodes => v_nodes,
    d_edges => v_deleted_edges,
    d_points => v_deleted_points,
    d_counties => array[p_county_id]
  );
end;
$$;

-- Creates a node, optionally joined by a road to p_from_node_id (branching from the
-- selected node).
create function public.map_create_node(
  p_lon double precision,
  p_lat double precision,
  p_type public.node_type,
  p_biome public.biome,
  p_name text default null,
  p_county_id bigint default null,
  p_from_node_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_node bigint;
  v_road bigint;
begin
  perform private.require_admin();
  if p_from_node_id is not null and not exists (select 1 from public.nodes where id = p_from_node_id) then
    perform private.fail('node_not_found');
  end if;

  insert into public.nodes (name, type, biome, lon, lat, county_id)
  values (nullif(trim(p_name), ''), p_type, p_biome, p_lon, p_lat, p_county_id)
  returning id into v_node;

  if p_from_node_id is not null then
    insert into public.roads (node_a, node_b)
    values (least(v_node, p_from_node_id), greatest(v_node, p_from_node_id))
    returning id into v_road;
  end if;

  return private.map_patch(
    p_nodes => array[v_node],
    p_roads => array_remove(array[v_road], null),
    p_counties => array_remove(array[p_county_id], null)
  );
end;
$$;

-- Saves a node's fields. Returns the counties whose main node may have changed with it.
create function public.map_update_node(
  p_node_id bigint,
  p_lon double precision,
  p_lat double precision,
  p_type public.node_type,
  p_biome public.biome,
  p_name text default null,
  p_county_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_county bigint;
begin
  perform private.require_admin();
  select county_id into v_old_county from public.nodes where id = p_node_id for update;
  if not found then
    perform private.fail('node_not_found');
  end if;

  update public.nodes
  set name = nullif(trim(p_name), ''), type = p_type, biome = p_biome, lon = p_lon, lat = p_lat, county_id = p_county_id
  where id = p_node_id;

  return private.map_patch(
    p_nodes => array[p_node_id],
    p_counties => array_remove(array[v_old_county, p_county_id], null)
  );
end;
$$;

-- The whole public map in one round trip (the Data API caps table reads at 1,000 rows).
create function public.get_world_map()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'empires', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.empires t), '[]'::jsonb),
    'kingdoms', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.kingdoms t), '[]'::jsonb),
    'duchies', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.duchies t), '[]'::jsonb),
    'counties', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.counties t), '[]'::jsonb),
    'nodes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.nodes t), '[]'::jsonb),
    'roads', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.roads t), '[]'::jsonb),
    'points', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.border_points t), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.border_edges t), '[]'::jsonb),
    'cultures', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort, t.id) from public.cultures t), '[]'::jsonb),
    'religions', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort, t.id) from public.religions t), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- Row-level security and grants
-- -----------------------------------------------------------------------------

alter table public.empires enable row level security;
alter table public.kingdoms enable row level security;
alter table public.duchies enable row level security;
alter table public.counties enable row level security;
alter table public.nodes enable row level security;
alter table public.roads enable row level security;
alter table public.border_points enable row level security;
alter table public.border_edges enable row level security;
alter table public.map_references enable row level security;

-- The world is public.
create policy "Anyone reads empires" on public.empires for select to anon, authenticated using (true);
create policy "Anyone reads kingdoms" on public.kingdoms for select to anon, authenticated using (true);
create policy "Anyone reads duchies" on public.duchies for select to anon, authenticated using (true);
create policy "Anyone reads counties" on public.counties for select to anon, authenticated using (true);
create policy "Anyone reads nodes" on public.nodes for select to anon, authenticated using (true);
create policy "Anyone reads roads" on public.roads for select to anon, authenticated using (true);
create policy "Anyone reads border points" on public.border_points for select to anon, authenticated using (true);
create policy "Anyone reads border edges" on public.border_edges for select to anon, authenticated using (true);

-- Admins shape the hierarchy directly; topology changes go through the map_* functions.
create policy "Admins add empires" on public.empires for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit empires" on public.empires for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete empires" on public.empires for delete to authenticated using ((select private.is_admin()));

create policy "Admins add kingdoms" on public.kingdoms for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit kingdoms" on public.kingdoms for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete kingdoms" on public.kingdoms for delete to authenticated using ((select private.is_admin()));

create policy "Admins add duchies" on public.duchies for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit duchies" on public.duchies for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete duchies" on public.duchies for delete to authenticated using ((select private.is_admin()));

create policy "Admins edit counties" on public.counties for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins delete nodes" on public.nodes for delete to authenticated using ((select private.is_admin()));

create policy "Admins add roads" on public.roads for insert to authenticated with check ((select private.is_admin()));
create policy "Admins delete roads" on public.roads for delete to authenticated using ((select private.is_admin()));

create policy "Admins move border points" on public.border_points for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins read map references" on public.map_references for select to authenticated using ((select private.is_admin()));
create policy "Admins add map references" on public.map_references for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit map references" on public.map_references for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete map references" on public.map_references for delete to authenticated using ((select private.is_admin()));

grant select on public.empires, public.kingdoms, public.duchies, public.counties, public.nodes, public.roads,
  public.border_points, public.border_edges to anon, authenticated;
grant insert, update, delete on public.empires, public.kingdoms, public.duchies to authenticated;
grant update (name, duchy_id, culture_id, religion_id, main_node_id) on public.counties to authenticated;
grant delete on public.nodes to authenticated;
grant insert, delete on public.roads to authenticated;
grant update (lon, lat) on public.border_points to authenticated;
grant select, insert, update, delete on public.map_references to authenticated;

-- Functions are callable only where granted below.
revoke all on all functions in schema public, private from public;
grant execute on function public.get_world_map() to anon, authenticated;
grant execute on function public.map_create_county(jsonb, text, bigint) to authenticated;
grant execute on function public.map_split_edge(bigint, double precision, double precision) to authenticated;
grant execute on function public.map_delete_point(bigint) to authenticated;
grant execute on function public.map_merge_points(bigint, bigint) to authenticated;
grant execute on function public.map_delete_county(bigint) to authenticated;
grant execute on function public.map_create_node(double precision, double precision, public.node_type, public.biome, text, bigint, bigint) to authenticated;
grant execute on function public.map_update_node(bigint, double precision, double precision, public.node_type, public.biome, text, bigint) to authenticated;
