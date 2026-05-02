/**
 * Supabase-generated types live here.
 *
 * Until the project is linked, this file exports a permissive `Database`
 * type so the Supabase clients can be constructed without compile errors.
 * Once linked, run:
 *
 *   npm run db:types
 *
 * which will overwrite this file with strictly-typed schema definitions
 * generated from the live Postgres schema. After that, you can remove the
 * `// @ts-expect-error` casts (if any) we used during development.
 *
 * Hand-curated types for query results live in `lib/types/game.types.ts`.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
