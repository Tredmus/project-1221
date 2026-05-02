# Migrations

Run these in order. Each file is idempotent against a fresh Supabase project
but assumes the previous file has already executed.

## Running

### Option A — Supabase SQL editor

1. Open your project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor**.
3. Paste the contents of `001_initial.sql` and click **Run**.
4. Verify in **Table Editor** that all tables exist and RLS is enabled
   (the shield icon next to each table name should be green).

### Option B — Supabase CLI

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Architectural notes

Read the comment block at the top of `001_initial.sql` before changing
anything. Key points:

- `provinces` and `locations` use **two separate FK columns** for owners
  (one `int` for countries, one `uuid` for clans), with a CHECK constraint
  enforcing exactly one. Don't replace this with a single typeless column.
- `game_events` has triggers blocking `UPDATE` and `DELETE`. It's an audit
  log. To "fix" a bad event, append a corrective row.
- `transfer_coins()` is the **only** way money should move. It atomically
  updates the balance and writes a ledger row. Server Actions call it via
  `supabase.rpc('transfer_coins', { ... })`.
- `handle_new_user()` runs on every `auth.users` insert and creates the
  matching `public.users` row with a placeholder username. The onboarding
  flow lets the user pick a real username.
- The cron block at the bottom is **commented out** — uncomment after
  you've deployed the `nightly-cycle` Edge Function and have the project
  URL + token to fill in.

## Adding a migration

Create `00N_<description>.sql`. Always:

1. Wrap multi-statement changes in a transaction (`BEGIN; ... COMMIT;`).
2. Use `IF EXISTS` / `IF NOT EXISTS` where Supabase allows it, so the
   migration is safe to re-run during development.
3. Update `lib/types/database.types.ts` afterwards by running
   `npm run db:types` (requires the project to be linked).
