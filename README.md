# Project 1221

A persistent browser and mobile MMO set in 1226 Europe and the Near East. The design lives in
[docs/GDD.md](docs/GDD.md) (the source of truth) and [docs/future-ideas.md](docs/future-ideas.md).

## Structure

```
apps/
  game/       Expo · iOS, Android, web — the player app (a placeholder screen for now)
  admin/      Next.js — the map editor; later world management and moderation (separate deploy)
packages/
  game-core/  pure TypeScript rules: the game calendar, map topology (county outlines, tier borders)
  shared/     Supabase client and config, DB types, translations (EN/BG)
              '@1221/shared' is server-safe; hooks live in '@1221/shared/react'
  ui/         design tokens (rarity colors) and shared React Native components
supabase/
  migrations/ the schema: tables, row-level security, database functions
  tests/      runs every migration in an in-memory Postgres and tests RLS and the functions
scripts/
  natural-earth.mjs  rebuilds the editor's coastline, land, rivers and lakes
```

npm workspaces + Turborepo, the same setup as FastCat (`D:\DEV\delivery-app`).

## Getting started

Requires Node 24+.

```bash
npm install
npm run admin      # http://localhost:3000 — the map editor
npm run game       # Expo dev server (press w for web, or scan the QR code with Expo Go)
npm run typecheck  # every app and package
npm run lint
npm test           # game-core unit tests
npm run db:test    # migrations + database tests in memory (no Docker needed)
```

## Database

The Supabase project is `fcpagfljhnozqmjxxlyx` (named Imperium in the dashboard). Its URL and
publishable key are in `packages/shared/src/config.ts`; the publishable key is public by design.
Schema changes are migration files in `supabase/migrations`, applied with the Supabase CLI
(`npx supabase login` once, then `npx supabase link --project-ref fcpagfljhnozqmjxxlyx`).

```bash
npm run db:test    # always first
npm run db:push    # apply new migrations to the linked project
npm run db:types   # regenerate packages/shared/src/database.types.ts from the linked project
```

Rules every migration follows (checked by `supabase/tests/lint.test.mjs`): RLS on every table,
explicit grants, fixed `search_path` on every function, an index on every foreign key, and every
function callable only by the roles listed in the test's allowlist.

Apps read through RLS. Writes that must stay consistent go through database functions
(`supabase.rpc(...)`); their errors carry a stable key in `error.hint`, translated with
`t(\`errors.${errorKey(error)}\`)` from `@1221/shared`.

| Area | Functions |
| ---- | --------- |
| Map (anyone) | `get_world_map` — the whole public map in one call |
| Map editor (admins) | `map_create_county`, `map_split_edge`, `map_delete_point`, `map_merge_points`, `map_delete_county`, `map_create_node`, `map_update_node` |
| Clans (players) | `create_clan`, `invite_to_clan`, `cancel_clan_invite`, `accept_clan_invite`, `decline_clan_invite`, `kick_from_clan`, `leave_clan`, `transfer_clan_leadership` |

### Admins

The admin role is checked in the database (`private.is_admin()`), not only in the admin app,
whose web code is public. To make an account an admin, create the user (Supabase dashboard →
Authentication → Add user), then run in the SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com';
```

## The map editor

`npm run admin`, sign in with an admin account, and you land on `/map`. Coordinates are stored as
real longitude/latitude; the editor shows them in Web Mercator (MapLibre GL). The game map's
projection is decided separately (GDD 13.1).

- **Counties** are the only drawn shapes. Their borders are one shared graph of points and edges
  (`border_points`, `border_edges`, with the county on each side), so neighbors never drift
  apart: moving a point moves it for every county that uses it.
- **Draw a county (C):** click points. Clicks snap to existing border points, onto existing
  borders (the edge is split) and onto the coastline; between two clicks on the same border or
  coastline the outline follows it. Click the first point or press Enter to finish. Shift draws
  a straight segment, Alt turns snapping off, Backspace removes the last point.
- **Select (V):** drag points and nodes; drop a point on another to glue them; double-click a
  border to add a point; Delete removes the selection. A county's panel adds islands or
  extensions ("Add an area").
- **Nodes (N), branch (B), roads (R):** a node is created alone, or branched from the selected
  node with a road to it. The road tool joins two existing nodes. Type and biome are set in the
  bar above the map or the node's panel. A town, castle, mine, farm or monastery is a county's
  main node, and a county has only one.
- **Tiers:** empires, kingdoms and duchies are made in the Tiers tab; their borders are computed
  from the counties in them. Display colors the map by any tier.
- **References:** upload a historical map image and stretch it over the coastline, or add an
  XYZ tile layer of an already georeferenced map (Allmaps, MapWarper).
- **Problems** lists what the GDD's map rules still need: counties without a main node or duchy,
  nodes outside counties, duchies without 2–3 counties.

Natural Earth (public domain) coastline, land, rivers and lakes are committed in
`apps/admin/public/natural-earth`; `npm run map:natural-earth` rebuilds them. County and node
labels use the Protomaps font server.
