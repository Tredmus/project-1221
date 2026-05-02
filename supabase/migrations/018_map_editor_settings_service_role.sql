-- Imperium — Migration 018: allow API access to map_editor_settings for service_role
--
-- The admin Server Actions and map-editor page use createAdminSupabase() (PostgREST
-- with the service role JWT). New tables are not automatically granted to
-- service_role; without this you get: "permission denied for table map_editor_settings".
-- We do not grant anon/authenticated here — only the server service role may touch
-- this table (RLS has no policies for those roles).
--
-- Safe to run on every environment where 017 was applied.

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.map_editor_settings
  TO service_role;
