// Runs the migrations in an in-memory Postgres (PGlite) with small stand-ins for what
// Supabase provides, so the schema and functions can be tested without Docker.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// API roles, auth.users + auth.uid(), and storage.
const SUPABASE_STANDINS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create schema storage;
  grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
  $$;

  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
`

export async function createDatabase() {
  const db = new PGlite()
  await db.exec(SUPABASE_STANDINS)
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    } catch (e) {
      throw new Error(`${file}: ${e.message}`)
    }
  }
  return db
}

// Run queries as a given caller:
//   a user id -> 'authenticated' with that JWT subject
//   'anon' / 'service_role' -> that API role
//   null -> postgres (trusted code, like a migration)
export function session(db) {
  async function as(user, fn) {
    return db.transaction(async (tx) => {
      if (user === 'anon' || user === 'service_role') {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: user })])
        await tx.exec(`set local role ${user}`)
      } else if (user) {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: user, role: 'authenticated' }),
        ])
        await tx.exec('set local role authenticated')
      }
      return fn(tx)
    })
  }
  const q = async (user, sql, params) => (await as(user, (tx) => tx.query(sql, params))).rows
  const one = async (user, sql, params) => (await q(user, sql, params))[0]
  return { as, q, one }
}

export function suite(name) {
  let passed = 0
  const failures = []
  return {
    async check(title, fn) {
      try {
        await fn()
        passed++
      } catch (e) {
        failures.push(`${title}: ${e.message}`)
      }
    },
    report() {
      console.log(`${name}: ${passed} passed, ${failures.length} failed`)
      for (const f of failures) console.log(`  ✗ ${f}`)
      return failures.length
    },
  }
}

export function assertEq(actual, expected, what = '') {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${what ? what + ': ' : ''}expected ${b}, got ${a}`)
}

export function assert(condition, what) {
  if (!condition) throw new Error(what)
}

// Expects the query to fail; `pattern` is matched against the error key (hint) and message.
export async function expectError(promise, pattern) {
  try {
    await promise
  } catch (e) {
    const text = `${e.hint ?? ''} | ${e.message}`
    if (pattern && !new RegExp(pattern, 'i').test(text)) {
      throw new Error(`wrong error: ${text}`)
    }
    return
  }
  throw new Error(`expected an error matching /${pattern}/`)
}

// Expects the query to fail with exactly this error key.
export async function expectKey(promise, key) {
  try {
    await promise
  } catch (e) {
    if (e.hint !== key) throw new Error(`expected error key ${key}, got ${e.hint ?? 'none'} (${e.message})`)
    return
  }
  throw new Error(`expected error key ${key}, but it succeeded`)
}

// Creates sign-in accounts (profiles follow by trigger). Names starting with "admin" get
// the admin role.
export async function createUsers(db, names) {
  const users = {}
  for (const name of names) {
    const { rows } = await db.query(`insert into auth.users (email) values ($1) returning id`, [`${name}@test.local`])
    users[name] = rows[0].id
    if (name.startsWith('admin')) {
      await db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [users[name]])
    }
  }
  return users
}

// A character for each account, born in the given country.
export async function createCharacters(db, users, countryId) {
  const characters = {}
  for (const [name, id] of Object.entries(users)) {
    const { rows } = await db.query(
      `insert into public.characters (account_id, name, country_id, culture_id, religion_id,
         strength, dexterity, agility, vitality, wits)
       select $1, $2, c.id, c.culture_id, c.religion_id, 5, 5, 5, 5, 5 from public.countries c where c.id = $3
       returning id`,
      [id, name[0].toUpperCase() + name.slice(1), countryId],
    )
    characters[name] = rows[0].id
  }
  return characters
}
