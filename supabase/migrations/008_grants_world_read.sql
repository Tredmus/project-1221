-- ================================================================
-- Imperium — Migration 008: GRANT + RLS for API reads (onboarding, map)
-- ================================================================
-- Table Editor in the dashboard uses a privileged role and bypasses RLS.
-- The Next.js app uses the anon key + user JWT (authenticated role).
-- Without GRANT SELECT on tables, PostgREST returns no rows / permission errors.
-- This migration is safe to run multiple times.

GRANT SELECT ON TABLE public.cities           TO anon, authenticated;
GRANT SELECT ON TABLE public.nodes            TO anon, authenticated;
GRANT SELECT ON TABLE public.node_connections TO anon, authenticated;
GRANT SELECT ON TABLE public.provinces        TO anon, authenticated;
GRANT SELECT ON TABLE public.regions          TO anon, authenticated;
GRANT SELECT ON TABLE public.building_types  TO anon, authenticated;
GRANT SELECT ON TABLE public.item_types      TO anon, authenticated;
GRANT SELECT ON TABLE public.positions       TO anon, authenticated;

-- Re-assert permissive read policies (Supabase API uses these roles explicitly)
DROP POLICY IF EXISTS "world_cities_read" ON public.cities;
CREATE POLICY "world_cities_read"
  ON public.cities
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "world_nodes_read" ON public.nodes;
CREATE POLICY "world_nodes_read"
  ON public.nodes
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "world_connections_read" ON public.node_connections;
CREATE POLICY "world_connections_read"
  ON public.node_connections
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "world_provinces_read" ON public.provinces;
CREATE POLICY "world_provinces_read"
  ON public.provinces
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "world_regions_read" ON public.regions;
CREATE POLICY "world_regions_read"
  ON public.regions
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "world_building_types_read" ON public.building_types;
CREATE POLICY "world_building_types_read"
  ON public.building_types
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "world_item_types_read" ON public.item_types;
CREATE POLICY "world_item_types_read"
  ON public.item_types
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "world_positions_read" ON public.positions;
CREATE POLICY "world_positions_read"
  ON public.positions
  FOR SELECT
  TO anon, authenticated
  USING (true);
