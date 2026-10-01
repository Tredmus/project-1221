// Structural rules every migration must keep: RLS everywhere, fixed search paths,
// indexed foreign keys, and no function callable by a role it wasn't granted to.
import { assertEq, createDatabase, suite } from './harness.mjs'

// Who may call each public function. Anything missing here must not be callable by apps.
const CALLABLE = {
  get_world_map: ['anon', 'authenticated'],
  map_create_county: ['authenticated'],
  map_split_edge: ['authenticated'],
  map_delete_point: ['authenticated'],
  map_merge_points: ['authenticated'],
  map_delete_county: ['authenticated'],
  map_create_node: ['authenticated'],
  map_update_node: ['authenticated'],
  create_clan: ['authenticated'],
  invite_to_clan: ['authenticated'],
  cancel_clan_invite: ['authenticated'],
  accept_clan_invite: ['authenticated'],
  decline_clan_invite: ['authenticated'],
  kick_from_clan: ['authenticated'],
  leave_clan: ['authenticated'],
  transfer_clan_leadership: ['authenticated'],
}

// RLS helpers the policies call as the requesting role.
const PRIVATE_CALLABLE = ['is_admin', 'my_character_id', 'my_clan_id']

export async function run() {
  const db = await createDatabase()
  const { check, report } = suite('lint')
  const list = async (sql) => (await db.query(sql)).rows

  await check('every public table has RLS enabled', async () => {
    const rows = await list(`select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity`)
    assertEq(rows, [])
  })
  await check('every function has a fixed search_path', async () => {
    const rows = await list(`select n.nspname || '.' || p.proname as fn from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)
    assertEq(rows, [])
  })
  await check('every foreign key has an index', async () => {
    const rows = await list(`select c.conrelid::regclass::text as tbl, c.conname from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey
        )`)
    assertEq(rows, [])
  })
  await check('public functions are callable only by the roles meant to call them', async () => {
    const rows = await list(`select p.proname as fn,
        array_remove(array[
          case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end,
          case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end
        ], null) as roles
      from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)
    const actual = Object.fromEntries(rows.map((r) => [r.fn, r.roles]))
    const expected = Object.fromEntries(Object.keys(actual).map((fn) => [fn, CALLABLE[fn] ?? 'NOT IN ALLOWLIST']))
    assertEq(actual, expected)
  })
  await check('private functions are callable by apps only when policies need them', async () => {
    const rows = await list(`select p.proname as fn from pg_proc p
      where p.pronamespace = 'private'::regnamespace
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
      order by 1`)
    assertEq(rows.map((r) => r.fn), PRIVATE_CALLABLE)
  })

  return report()
}
