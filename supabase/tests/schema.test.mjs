// Accounts, reference data, characters, offices: row-level security and constraints.
import { assertEq, createCharacters, createDatabase, createUsers, expectError, expectKey, session, suite } from './harness.mjs'

export async function run() {
  const db = await createDatabase()
  const { as, q, one } = session(db)
  const { check, report } = suite('schema')
  const U = await createUsers(db, ['admin', 'alice', 'bob'])

  await check('every account gets a profile', async () => {
    assertEq((await one(null, 'select count(*)::int as n from public.profiles')).n, 3)
  })
  await check('players see only their own profile and roles', async () => {
    assertEq((await q(U.alice, 'select id from public.profiles')).map((r) => r.id), [U.alice])
    assertEq((await q(U.alice, 'select * from public.user_roles')).length, 0)
    assertEq((await q(U.admin, 'select role from public.user_roles')).map((r) => r.role), ['admin'])
    assertEq((await q(U.admin, 'select id from public.profiles')).length, 3)
  })
  await check('players change their locale, nothing else', async () => {
    await q(U.alice, `update public.profiles set locale = 'bg' where id = $1`, [U.alice])
    assertEq((await one(null, 'select locale from public.profiles where id = $1', [U.alice])).locale, 'bg')
    await expectError(q(U.alice, `update public.profiles set created_at = now() where id = $1`, [U.alice]), 'permission denied')
    await q(U.alice, `update public.profiles set locale = 'en' where id = $1`, [U.bob])
    assertEq((await one(null, 'select locale from public.profiles where id = $1', [U.bob])).locale, null, 'other profile untouched')
  })
  await check('nobody grants roles from an app', async () => {
    await expectError(q(U.admin, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [U.bob]), 'permission denied')
  })

  await check('anyone reads the draft cultures and religions', async () => {
    assertEq((await one('anon', 'select count(*)::int as n from public.cultures')).n, 12)
    assertEq((await one('anon', 'select count(*)::int as n from public.religions')).n, 8)
  })
  await check('only admins edit cultures', async () => {
    await expectError(q(U.alice, `insert into public.cultures (id, name) values ('polish', 'Polish')`), 'row-level security')
    await q(U.admin, `insert into public.cultures (id, name) values ('polish', 'Polish')`)
    await q(U.admin, `delete from public.cultures where id = 'polish'`)
  })

  let country
  await check('admins add countries; anyone reads them', async () => {
    await expectError(
      q(U.alice, `insert into public.countries (name, culture_id, religion_id) values ('Bulgaria', 'south_slavic', 'orthodox')`),
      'row-level security',
    )
    country = (await one(U.admin, `insert into public.countries (name, culture_id, religion_id)
      values ('Bulgaria', 'south_slavic', 'orthodox') returning id`)).id
    assertEq((await q('anon', 'select name from public.countries')).map((r) => r.name), ['Bulgaria'])
  })

  let C
  await check('one character per account, names unique', async () => {
    C = await createCharacters(db, { alice: U.alice }, country)
    await expectError(createCharacters(db, { alice: U.alice }, country), 'duplicate key')
    await expectError(
      db.query(`insert into public.characters (account_id, name, country_id, culture_id, religion_id, strength, dexterity, agility, vitality, wits)
        values ($1, 'ALICE', $2, 'south_slavic', 'orthodox', 1, 1, 1, 1, 1)`, [U.bob, country]),
      'characters_name_idx',
    )
  })
  await check('players read characters but cannot write them yet', async () => {
    assertEq((await q(U.bob, 'select name from public.characters')).map((r) => r.name), ['Alice'])
    await expectError(q('anon', 'select * from public.characters'), 'permission denied')
    await expectError(q(U.alice, `update public.characters set level = 50 where id = $1`, [C.alice]), 'permission denied')
    await expectError(
      q(U.bob, `insert into public.characters (account_id, name, country_id, culture_id, religion_id, strength, dexterity, agility, vitality, wits)
        values ($1, 'Bob', $2, 'south_slavic', 'orthodox', 1, 1, 1, 1, 1)`, [U.bob, country]),
      'permission denied',
    )
  })

  await check('offices sit on the right tier and are admin-managed', async () => {
    const county = (await one(null, `insert into public.counties (name) values ('Tarnovo') returning id`)).id
    await expectError(q(U.admin, `insert into public.offices (kind, duchy_id) values ('mayor', null)`), 'check constraint')
    const office = (await one(U.admin, `insert into public.offices (kind, county_id, npc_holder_name)
      values ('mayor', $1, 'Boyar Stoyan') returning id`, [county])).id
    assertEq((await q(U.alice, `update public.offices set npc_holder_name = 'Me' where id = $1 returning id`, [office])).length, 0, 'players change no office')
    assertEq((await q('anon', 'select npc_holder_name from public.offices')).map((r) => r.npc_holder_name), ['Boyar Stoyan'])
    await expectError(q(U.admin, `insert into public.offices (kind, county_id) values ('mayor', $1)`, [county]), 'duplicate key')
  })
  await check('votes are private to the voter and admins', async () => {
    const [office] = await q(null, 'select id from public.offices')
    const election = (await one(null, `insert into public.elections (office_id, opens_at, closes_at)
      values ($1, now(), now() + interval '1 day') returning id`, [office.id])).id
    await q(null, `insert into public.election_candidates (election_id, character_id) values ($1, $2)`, [election, C.alice])
    await q(null, `insert into public.election_votes (election_id, voter_character_id, candidate_character_id) values ($1, $2, $2)`, [election, C.alice])
    assertEq((await q(U.alice, 'select * from public.election_votes')).length, 1)
    assertEq((await q(U.bob, 'select * from public.election_votes')).length, 0)
    assertEq((await q(U.admin, 'select * from public.election_votes')).length, 1)
    await expectError(q('anon', 'select * from public.election_votes'), 'permission denied')
  })

  await check('admin-only functions refuse players', async () => {
    await expectKey(q(U.alice, `select public.map_create_county('[]'::jsonb)`), 'not_admin')
    await expectError(q('anon', `select public.map_create_county('[]'::jsonb)`), 'permission denied')
  })
  await check('the admin check is in the database, not the app', async () => {
    await as(U.alice, async (tx) => {
      assertEq((await tx.query('select private.is_admin() as a')).rows[0].a, false)
    })
    await as(U.admin, async (tx) => {
      assertEq((await tx.query('select private.is_admin() as a')).rows[0].a, true)
    })
  })

  return report()
}
