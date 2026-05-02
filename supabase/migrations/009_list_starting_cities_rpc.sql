-- ================================================================
-- Imperium — Migration 009: RPC for onboarding city list
-- ================================================================
-- Direct SELECT from the app can still return 0 rows when GRANT/RLS and
-- the PostgREST stack disagree with what you see in the Table Editor.
-- This function runs as SECURITY DEFINER (owner bypasses RLS for the inner
-- SELECT) and only exposes id, name, properties — same as public world data.

CREATE OR REPLACE FUNCTION public.list_starting_cities()
RETURNS TABLE (
  id int,
  name text,
  properties jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.name, c.properties
  FROM public.cities c
  ORDER BY c.name;
$$;

REVOKE ALL ON FUNCTION public.list_starting_cities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_starting_cities() TO anon, authenticated;
