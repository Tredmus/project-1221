// The map editor's topology functions: shared borders, splitting, merging, deleting,
// nodes and roads, main node and main county rules.
import { assert, assertEq, createDatabase, createUsers, expectError, expectKey, session, suite } from './harness.mjs'

export async function run() {
  const db = await createDatabase()
  const { q, one } = session(db)
  const { check, report } = suite('map')
  const U = await createUsers(db, ['admin', 'alice'])

  const call = async (user, sql, params) => (await one(user, `select ${sql} as r`, params)).r
  const draw = (points, name, countyId = null) =>
    call(U.admin, 'public.map_create_county($1::jsonb, $2, $3)', [JSON.stringify(points), name, countyId])
  const edges = () => q(null, 'select * from public.border_edges order by id')
  const pointAt = async (lon, lat) => (await one(null, 'select id from public.border_points where lon = $1 and lat = $2', [lon, lat]))?.id
  const edgeBetween = (a, b) =>
    one(null, `select * from public.border_edges
      where least(point_a, point_b) = least($1::bigint, $2::bigint) and greatest(point_a, point_b) = greatest($1::bigint, $2::bigint)`, [a, b])
  // The county on each side of a segment walked from a to b.
  const sides = async (a, b) => {
    const e = await edgeBetween(a, b)
    if (!e) return null
    return String(e.point_a) === String(a) ? [e.left_county_id, e.right_county_id] : [e.right_county_id, e.left_county_id]
  }
  const id = (x) => (x == null ? null : String(x))

  // A: the square 20..21 E, 40..41 N, drawn counter-clockwise.
  let A, B, p1, p2, p3, p4, q1, q2
  await check('a county drawn counter-clockwise sits on the left of its edges', async () => {
    const patch = await draw([{ lon: 20, lat: 40 }, { lon: 21, lat: 40 }, { lon: 21, lat: 41 }, { lon: 20, lat: 41 }], 'Alpha')
    A = String(patch.counties[0].id)
    assertEq(patch.counties[0].name, 'Alpha')
    assertEq(patch.points.length, 4)
    assertEq(patch.edges.length, 4)
    for (const e of patch.edges) assertEq([id(e.left_county_id), id(e.right_county_id)], [A, null])
    ;[p1, p2, p3, p4] = await Promise.all([pointAt(20, 40), pointAt(21, 40), pointAt(21, 41), pointAt(20, 41)])
  })

  await check('a neighbor reuses the shared points and takes the free side', async () => {
    // B: 21..22 E, drawn clockwise, reusing A's east edge.
    const patch = await draw([{ id: p3 }, { lon: 22, lat: 41 }, { lon: 22, lat: 40 }, { id: p2 }], 'Beta')
    B = String(patch.counties[0].id)
    ;[q1, q2] = await Promise.all([pointAt(22, 40), pointAt(22, 41)])
    assertEq((await sides(p2, p3)).map(id), [A, B], 'shared edge walking north: A on the left, B on the right')
    assertEq((await sides(q1, q2)).map(id), [B, null], 'B east edge walking north')
    assertEq((await edges()).length, 7)
    assertEq((await one(null, 'select count(*)::int as n from public.border_points')).n, 6)
  })

  await check('drawing over a taken side is an overlap', async () => {
    await expectKey(draw([{ id: p2 }, { id: p3 }, { lon: 20.5, lat: 40.5 }], 'Gamma'), 'overlap')
    assertEq((await one(null, `select count(*)::int as n from public.counties where name = 'Gamma'`)).n, 0, 'nothing kept')
  })

  await check('outlines need three different points', async () => {
    await expectKey(draw([{ id: p1 }, { id: p2 }], 'Bad'), 'ring_invalid')
    await expectKey(draw([{ id: p1 }, { id: p2 }, { id: p1 }, { id: p3 }], 'Bad'), 'ring_invalid')
    await expectKey(draw([{ lon: 30, lat: 30 }, { lon: 31, lat: 30 }, { lon: 32, lat: 30 }], 'Flat'), 'ring_invalid')
  })

  let mid
  await check('splitting a shared edge gives the new point to both counties', async () => {
    const e = await edgeBetween(p2, p3)
    const patch = await call(U.admin, 'public.map_split_edge($1, $2, $3)', [e.id, 21, 40.5])
    mid = patch.points[0].id
    assertEq((await sides(p2, mid)).map(id), [A, B])
    assertEq((await sides(mid, p3)).map(id), [A, B])
    assertEq(await edgeBetween(p2, p3), undefined, 'old segment gone')
  })

  await check('a point between two like segments can be removed', async () => {
    const patch = await call(U.admin, 'public.map_delete_point($1)', [mid])
    assertEq(patch.deleted.points.map(id), [id(mid)])
    assertEq((await sides(p2, p3)).map(id), [A, B])
    assertEq((await edges()).length, 7)
  })

  await check('junctions and last corners stay', async () => {
    await expectKey(call(U.admin, 'public.map_delete_point($1)', [p2]), 'point_is_junction')
    const t = await draw([{ lon: 30, lat: 30 }, { lon: 31, lat: 30 }, { lon: 30, lat: 31 }], 'Tri')
    await expectKey(call(U.admin, 'public.map_delete_point($1)', [await pointAt(31, 30)]), 'ring_too_small')
    await call(U.admin, 'public.map_delete_county($1)', [t.counties[0].id])
  })

  await check('a point placed on an existing edge splits it', async () => {
    // D: south of A, sharing the east half of A's bottom edge.
    const bottom = await edgeBetween(p1, p2)
    const patch = await draw([{ edge: bottom.id, lon: 20.5, lat: 40 }, { id: p2 }, { lon: 21, lat: 39 }, { lon: 20.5, lat: 39 }], 'Delta')
    const D = id(patch.counties[0].id)
    const m = await pointAt(20.5, 40)
    assertEq((await sides(p1, m)).map(id), [A, null], 'west half stays A only')
    assertEq((await sides(m, p2)).map(id), [A, D], 'east half: A north, D south')
  })

  await check('two points on the same edge split the right pieces', async () => {
    const top = await edgeBetween(p3, p4)
    const patch = await draw(
      [{ edge: top.id, lon: 20.25, lat: 41 }, { edge: top.id, lon: 20.75, lat: 41 }, { lon: 20.75, lat: 42 }, { lon: 20.25, lat: 42 }],
      'Phi',
    )
    const F = id(patch.counties[0].id)
    const [m1, m2] = await Promise.all([pointAt(20.25, 41), pointAt(20.75, 41)])
    assertEq((await sides(m1, m2)).map(id), [F, A], 'walking east: F north (left), A south (right)')
    assertEq((await sides(p3, m2)).map(id), [A, null])
    assertEq((await sides(m1, p4)).map(id), [A, null])
  })

  let G
  await check('gluing points makes neighbors share an edge', async () => {
    const patch = await draw([{ lon: 22.01, lat: 40 }, { lon: 23, lat: 40 }, { lon: 23, lat: 41 }, { lon: 22.01, lat: 41 }], 'Gimel')
    G = id(patch.counties[0].id)
    const [g1, g4] = await Promise.all([pointAt(22.01, 40), pointAt(22.01, 41)])
    await call(U.admin, 'public.map_merge_points($1, $2)', [g1, q1])
    const merged = await call(U.admin, 'public.map_merge_points($1, $2)', [g4, q2])
    assertEq((await sides(q1, q2)).map(id), [B, G], 'walking north: B west, G east')
    assert(merged.deleted.edges.length === 1, 'the duplicate segment is removed')
    assertEq(await pointAt(22.01, 40), undefined)
  })

  await check('merging points that would put two counties on the same side is an overlap', async () => {
    // Two triangles fanning out of one point, both north of their bottom edge.
    await draw([{ lon: 40, lat: 40 }, { lon: 41, lat: 40 }, { lon: 40.5, lat: 41 }], 'Pi')
    await draw([{ id: await pointAt(40, 40) }, { lon: 41, lat: 40.01 }, { lon: 40.5, lat: 41.5 }], 'Psi')
    await expectKey(call(U.admin, 'public.map_merge_points($1, $2)', [await pointAt(41, 40), await pointAt(41, 40.01)]), 'overlap')
  })

  await check('deleting a county keeps shared borders and drops its own', async () => {
    const patch = await call(U.admin, 'public.map_delete_county($1)', [G])
    assertEq((await sides(q1, q2)).map(id), [B, null])
    assertEq(patch.deleted.points.length, 2, 'its two outer corners go')
    assertEq((await one(null, 'select count(*)::int as n from public.counties where id = $1', [G])).n, 0)
  })

  await check('another ring next to the county extends it', async () => {
    // A strip east of B, added to B: the shared edge q1-q2 dissolves.
    await draw([{ id: q1 }, { lon: 22.5, lat: 40 }, { lon: 22.5, lat: 41 }, { id: q2 }], null, B)
    assertEq(await edgeBetween(q1, q2), undefined)
    assertEq((await sides(await pointAt(22.5, 40), await pointAt(22.5, 41))).map(id), [B, null])
  })

  let town, castle, road
  await check('a town in a county without a main node becomes its main node', async () => {
    const patch = await call(U.admin, 'public.map_create_node($1, $2, $3, $4, $5, $6)', [20.5, 40.5, 'town', 'plains', 'Alphaton', A])
    town = patch.nodes[0].id
    assertEq(id(patch.counties[0].main_node_id), id(town))
  })

  await check('branching from a node adds a road; other nodes do not replace the main node', async () => {
    const patch = await call(U.admin, 'public.map_create_node($1, $2, $3, $4, $5, $6, $7)', [20.7, 40.7, 'castle', 'hills', null, A, town])
    castle = patch.nodes[0].id
    road = patch.roads[0]
    assertEq([id(road.node_a), id(road.node_b)], [id(town), id(castle)])
    assertEq(id(patch.counties[0].main_node_id), id(town))
  })

  await check('the main node must be a main type inside the county', async () => {
    const r = await call(U.admin, 'public.map_create_node($1, $2, $3, $4, $5, $6)', [21.5, 40.5, 'crossroads', 'plains', null, B])
    await expectKey(q(U.admin, 'update public.counties set main_node_id = $1 where id = $2', [r.nodes[0].id, B]), 'main_node_invalid')
    await expectKey(q(U.admin, 'update public.counties set main_node_id = $1 where id = $2', [castle, B]), 'main_node_invalid')
  })

  await check('a main node that moves or changes type stops being the main node', async () => {
    await call(U.admin, 'public.map_update_node($1, $2, $3, $4, $5, $6, $7)', [town, 21.5, 40.2, 'town', 'plains', 'Alphaton', B])
    assertEq((await q(null, 'select id, main_node_id from public.counties where id in ($1, $2) order by id', [A, B])).map((c) => id(c.main_node_id)), [null, id(town)])
    await call(U.admin, 'public.map_update_node($1, $2, $3, $4, $5, $6, $7)', [town, 21.5, 40.2, 'ford', 'plains', 'Alphaton', B])
    assertEq((await one(null, 'select main_node_id from public.counties where id = $1', [B])).main_node_id, null)
  })

  await check('deleting a node removes its roads', async () => {
    await q(U.admin, 'delete from public.nodes where id = $1', [castle])
    assertEq((await one(null, 'select count(*)::int as n from public.roads')).n, 0)
  })

  await check('admins build the hierarchy; the main county must be in the duchy', async () => {
    const empire = (await one(U.admin, `insert into public.empires (name) values ('Bulgarian Tsardom') returning id`)).id
    const kingdom = (await one(U.admin, `insert into public.kingdoms (name, empire_id) values ('Moesia', $1) returning id`, [empire])).id
    const duchy = (await one(U.admin, `insert into public.duchies (name, kingdom_id) values ('Tarnovo', $1) returning id`, [kingdom])).id
    await q(U.admin, 'update public.counties set duchy_id = $1 where id = $2', [duchy, A])
    await q(U.admin, 'update public.duchies set main_county_id = $1 where id = $2', [A, duchy])
    await expectKey(q(U.admin, 'update public.duchies set main_county_id = $1 where id = $2', [B, duchy]), 'main_county_invalid')
    await q(U.admin, 'update public.counties set duchy_id = null where id = $1', [A])
    assertEq((await one(null, 'select main_county_id from public.duchies where id = $1', [duchy])).main_county_id, null)
  })

  await check('players cannot change the map', async () => {
    await expectError(q(U.alice, `insert into public.empires (name) values ('Mine')`), 'row-level security')
    assertEq((await q(U.alice, 'update public.border_points set lon = 0 where id = $1 returning id', [p1])).length, 0)
    assertEq((await q(U.alice, `update public.counties set name = 'Mine' where id = $1 returning id`, [A])).length, 0)
    await expectError(q(U.alice, 'delete from public.border_edges'), 'permission denied')
    await expectKey(q(U.alice, `select public.map_split_edge(1, 0, 0)`), 'not_admin')
  })

  await check('admins move points directly', async () => {
    await q(U.admin, 'update public.border_points set lon = 19.9 where id = $1', [p1])
    assertEq((await one(null, 'select lon from public.border_points where id = $1', [p1])).lon, 19.9)
  })

  await check('anyone loads the whole map in one call', async () => {
    const map = await call('anon', 'public.get_world_map()')
    assertEq(Object.keys(map).sort(), ['counties', 'cultures', 'duchies', 'edges', 'empires', 'kingdoms', 'nodes', 'points', 'religions', 'roads'])
    assertEq(map.counties.length, (await one(null, 'select count(*)::int as n from public.counties')).n)
    assertEq(map.edges.length, (await edges()).length)
  })

  await check('reference images are admin-only and need a box or an https tile URL', async () => {
    await q(U.admin, `insert into public.map_references (name, kind, storage_path, west, south, east, north)
      values ('Shepherd 1214', 'image', 'balkans.webp', 18, 38, 30, 46)`)
    await q(U.admin, `insert into public.map_references (name, kind, tile_url)
      values ('Allmaps', 'tiles', 'https://allmaps.xyz/maps/abc/{z}/{x}/{y}.png')`)
    await expectError(q(U.admin, `insert into public.map_references (name, kind, tile_url) values ('Bad', 'tiles', 'http://x/{z}')`), 'check constraint')
    await expectError(q(U.admin, `insert into public.map_references (name, kind, storage_path, west, south, east, north)
      values ('Bad', 'image', 'x.png', 30, 38, 18, 46)`), 'check constraint')
    assertEq((await q(U.alice, 'select * from public.map_references')).length, 0)
    await expectError(q('anon', 'select * from public.map_references'), 'permission denied')
  })

  return report()
}
