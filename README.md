# Imperium

A browser-based medieval RPG inspired by Renaissance Kingdoms. Multiplayer,
turn-based, with a daily night-cycle that processes production, battles,
wages, and elections at midnight UTC.

> Working title. The codebase uses `Imperium` as a placeholder until the final
> name is chosen.

## Stack

- **Next.js 15** (App Router, TypeScript, Server Actions)
- **Supabase** (Postgres, Auth, Realtime, Edge Functions, pg_cron)
- **Tailwind CSS** with a custom Byzantine-imperial design system
- **Zustand** for lightweight client state
- **date-fns** for date math

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase keys
npm run dev
```

Then run `supabase/migrations/001_initial.sql` in the Supabase SQL editor (or
via the Supabase CLI). See `supabase/migrations/README.md` for details on the
ordering and the architectural choices baked into the schema.

## Repository layout

```
app/                       App Router pages, layouts, and Server Actions
  auth/                    Login, register, callback, logout
  onboarding/              First-login character creation gate
  game/                    Authenticated game pages (map, character, city, ...)
  admin/                   Admin tooling (node seeding, world management)
components/                Reusable UI organized by domain
  ui/                      Shared primitives (buttons, AP bar, coin display)
  character/               Character sheet, stats, inventory
  map/                     SVG map, node markers, travel panel
  ...
lib/
  supabase/
    client.ts              Browser client (anon key, RLS enforced)
    server.ts              Server Component / Server Action client (cookies)
    admin.ts              SERVICE-ROLE client. Server-only. Bypasses RLS.
    middleware.ts          Cookie refresh helper for the root middleware
  game/
    getCurrentCharacter.ts Auth + character + node fetch (used everywhere)
    pathfinding.ts         Dijkstra on the node graph
    travel.ts              Travel cost & effect calculations
    nightly.ts             Nightly cron logic (called from Edge Functions)
  types/
    database.types.ts      Generated from Supabase schema
    game.types.ts          Hand-written game-specific types
supabase/
  migrations/              Versioned SQL migrations (run in order)
  functions/               Edge Functions (nightly-cycle, pathfinding)
```

## Architecture rules

These are non-negotiable. Every PR should respect them:

1. **RLS is always on.** Service-role key is only ever used from
   `lib/supabase/admin.ts` and Edge Functions. Never imported into a route
   segment that runs on the user's request path.
2. **All writes go through Server Actions.** Client components never call
   `supabase.from(...).insert(...)` directly.
3. **Money flows through `transferCoins()` and the `ledger_entries` table.**
   Every coin delta is double-entry-style audited.
4. **`game_events` is append-only.** Never `UPDATE` or `DELETE` rows.
5. **AP-spending actions check AP atomically** in a single SQL statement
   (or stored procedure) before applying the effect.
6. **Inventory mutations always UPSERT** with the unique
   `(character_id, item_type_id)` constraint, never read-then-write.
7. **The map polls; clan chat and notifications use Realtime.** Don't add
   Realtime subscriptions to the map page.

## Aesthetic

Dark, refined, Byzantine. Parchment, deep burgundy, aged gold. Serif display
fonts only. The design tokens live in `app/globals.css` as CSS variables and
are aliased in `tailwind.config.ts`. Reach into `var(--color-*)` from
components — never hardcode hex.

## Design rules in `.cursor/rules`

If you are an AI agent working on this repo, read the documents in
`.cursor/rules/` before making changes. They encode the conventions above
in a form that you can apply at edit time.

_Alea Iacta Est._
