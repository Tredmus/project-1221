// Clans v1: create, invite, accept, decline, kick, leave, hand over, disband.
import { assertEq, createCharacters, createDatabase, createUsers, expectError, expectKey, session, suite } from './harness.mjs'

export async function run() {
  const db = await createDatabase()
  const { q, one } = session(db)
  const { check, report } = suite('clans')

  const U = await createUsers(db, ['alice', 'bob', 'carol', 'dave', 'eve'])
  const country = (await one(null, `insert into public.countries (name, culture_id, religion_id)
    values ('Bulgaria', 'south_slavic', 'orthodox') returning id`)).id
  const { eve: _, ...players } = U
  const C = await createCharacters(db, players, country)

  const rpc = (user, fn, ...args) =>
    one(user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args).then((row) => row.r)
  const clanOf = async (character) =>
    (await one(null, 'select clan_id from public.clan_members where character_id = $1', [character]))?.clan_id ?? null
  const leaderOf = async (clan) => (await one(null, 'select leader_character_id from public.clans where id = $1', [clan]))?.leader_character_id

  let clan
  await check('a player without a character cannot found a clan', () => expectKey(rpc(U.eve, 'create_clan', 'Nobodies'), 'no_character'))

  await check('the founder leads and is a member', async () => {
    clan = await rpc(U.alice, 'create_clan', '  Order of the  Dragon ')
    assertEq((await one(null, 'select name from public.clans where id = $1', [clan])).name, 'Order of the Dragon')
    assertEq(await leaderOf(clan), C.alice)
    assertEq(await clanOf(C.alice), clan)
  })

  await check('clan names are unique and 3-32 characters', async () => {
    await expectKey(rpc(U.bob, 'create_clan', 'order of the dragon'), 'clan_name_taken')
    await expectKey(rpc(U.bob, 'create_clan', 'ab'), 'clan_name_invalid')
  })

  await check('only the leader invites, once per player, and not clan members', async () => {
    await expectKey(rpc(U.bob, 'invite_to_clan', C.carol), 'not_clan_leader')
    await rpc(U.alice, 'invite_to_clan', C.bob)
    await expectKey(rpc(U.alice, 'invite_to_clan', C.bob), 'already_invited')
    await expectKey(rpc(U.alice, 'invite_to_clan', C.alice), 'target_in_clan')
  })

  await check('the invitee and the clan see the invite; others do not', async () => {
    assertEq((await q(U.bob, 'select clan_id from public.clan_invites')).length, 1)
    assertEq((await q(U.alice, 'select clan_id from public.clan_invites')).length, 1)
    assertEq((await q(U.carol, 'select clan_id from public.clan_invites')).length, 0)
  })

  await check('accepting joins the clan and clears other invites', async () => {
    const other = await rpc(U.carol, 'create_clan', 'Varangian Guard')
    await rpc(U.carol, 'invite_to_clan', C.bob)
    await rpc(U.bob, 'accept_clan_invite', clan)
    assertEq(await clanOf(C.bob), clan)
    assertEq((await one(null, 'select count(*)::int as n from public.clan_invites where character_id = $1', [C.bob])).n, 0)
    await expectKey(rpc(U.bob, 'accept_clan_invite', other), 'invite_not_found')
    await expectKey(rpc(U.bob, 'create_clan', 'Second'), 'already_in_clan')
  })

  await check('declining and cancelling remove the invite', async () => {
    await rpc(U.alice, 'invite_to_clan', C.dave)
    await rpc(U.dave, 'decline_clan_invite', clan)
    await expectKey(rpc(U.dave, 'accept_clan_invite', clan), 'invite_not_found')
    await rpc(U.alice, 'invite_to_clan', C.dave)
    await rpc(U.alice, 'cancel_clan_invite', C.dave)
    await expectKey(rpc(U.alice, 'cancel_clan_invite', C.dave), 'invite_not_found')
  })

  await check('the leader kicks members but not themselves', async () => {
    await expectKey(rpc(U.alice, 'kick_from_clan', C.alice), 'cannot_kick_self')
    await expectKey(rpc(U.alice, 'kick_from_clan', C.dave), 'not_clan_member')
    await expectKey(rpc(U.bob, 'kick_from_clan', C.alice), 'not_clan_leader')
  })

  await check('the leader hands over before leaving', async () => {
    await expectKey(rpc(U.alice, 'leave_clan'), 'leader_must_hand_over')
    await expectKey(rpc(U.alice, 'transfer_clan_leadership', C.dave), 'not_clan_member')
    await rpc(U.alice, 'transfer_clan_leadership', C.bob)
    assertEq(await leaderOf(clan), C.bob)
    await rpc(U.alice, 'leave_clan')
    assertEq(await clanOf(C.alice), null)
    await expectKey(rpc(U.alice, 'leave_clan'), 'not_in_clan')
  })

  await check('the last member leaving disbands the clan', async () => {
    await rpc(U.bob, 'leave_clan')
    assertEq(await leaderOf(clan), undefined)
  })

  await check('a deleted leader is replaced by the longest-serving member', async () => {
    const guard = (await one(null, `select id from public.clans where name = 'Varangian Guard'`)).id
    await rpc(U.carol, 'invite_to_clan', C.dave)
    await rpc(U.dave, 'accept_clan_invite', guard)
    await rpc(U.carol, 'invite_to_clan', C.alice)
    await rpc(U.alice, 'accept_clan_invite', guard)
    await db.query('delete from auth.users where id = $1', [U.carol])
    assertEq(await leaderOf(guard), C.dave)
    await db.query('delete from auth.users where id in ($1, $2)', [U.dave, U.alice])
    assertEq(await leaderOf(guard), undefined, 'disbanded when nobody is left')
  })

  await check('clan tables change only through the functions', async () => {
    await expectError(q(U.bob, `insert into public.clans (name, leader_character_id) values ('Direct', $1)`, [C.bob]), 'permission denied')
    await expectError(q(U.bob, `delete from public.clan_members`), 'permission denied')
    await expectError(q('anon', `select * from public.clans`), 'permission denied')
  })

  return report()
}
