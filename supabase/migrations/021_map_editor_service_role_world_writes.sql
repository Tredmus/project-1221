-- Imperium — Migration 021: service_role DML on world tables (map editor + admin seed)
--
-- PostgREST runs as database role `service_role` when using the service JWT.
-- Migration 008 grants anon/authenticated SELECT only. service_role needs
-- explicit GRANTs for INSERT/UPDATE/DELETE (see 018 for map_editor_settings).
--
-- Safe to re-run; GRANT is idempotent for the same privileges.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.node_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.counties TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.locations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cities TO service_role;
GRANT SELECT, UPDATE ON TABLE public.characters TO service_role;
GRANT SELECT, UPDATE ON TABLE public.armies TO service_role;
GRANT SELECT, UPDATE ON TABLE public.countries TO service_role;
GRANT SELECT, DELETE ON TABLE public.battle_orders TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.empires TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kingdoms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duchies TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.nodes_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.counties_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.locations_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cities_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.empires_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.kingdoms_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.duchies_id_seq TO service_role;
