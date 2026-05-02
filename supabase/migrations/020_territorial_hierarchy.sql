-- Imperium — Migration 020: territorial hierarchy (counties + de jure ladder)
--
-- Renames public.provinces → public.counties; nodes.province_id → county_id;
-- countries.capital_province_id → capital_county_id.
-- Adds empires, kingdoms, duchies with de jure parents, de facto controllers,
-- and capital links to the level below (empire → kingdom → duchy → county → node).

-- ---------------------------------------------------------------------------
-- 1. New tables (capital FKs added after counties exist)
-- ---------------------------------------------------------------------------

CREATE TABLE public.empires (
  id                    serial PRIMARY KEY,
  name                  text NOT NULL,
  de_jure_parent_id     int REFERENCES public.empires(id),
  controller_country_id int REFERENCES public.countries(id),
  capital_kingdom_id    int UNIQUE
);

CREATE TABLE public.kingdoms (
  id                    serial PRIMARY KEY,
  name                  text NOT NULL,
  de_jure_parent_id     int REFERENCES public.kingdoms(id),
  de_jure_empire_id     int REFERENCES public.empires(id),
  controller_country_id int REFERENCES public.countries(id),
  capital_duchy_id      int UNIQUE
);

CREATE TABLE public.duchies (
  id                    serial PRIMARY KEY,
  name                  text NOT NULL,
  de_jure_parent_id     int REFERENCES public.duchies(id),
  de_jure_kingdom_id    int REFERENCES public.kingdoms(id),
  controller_country_id int REFERENCES public.countries(id),
  capital_county_id     int UNIQUE
);

-- ---------------------------------------------------------------------------
-- 2. Rename provinces → counties
-- ---------------------------------------------------------------------------

ALTER TABLE public.provinces RENAME TO counties;

ALTER SEQUENCE public.provinces_id_seq RENAME TO counties_id_seq;

ALTER TABLE public.counties RENAME CONSTRAINT provinces_pkey TO counties_pkey;
ALTER TABLE public.counties RENAME CONSTRAINT province_owner_consistency TO county_owner_consistency;

ALTER TABLE public.counties RENAME CONSTRAINT fk_province_owner_country TO fk_county_owner_country;
ALTER TABLE public.counties RENAME CONSTRAINT fk_province_owner_clan TO fk_county_owner_clan;
ALTER TABLE public.counties RENAME CONSTRAINT fk_province_capital_node TO fk_county_capital_node;

ALTER TABLE public.counties RENAME CONSTRAINT provinces_region_id_fkey TO counties_region_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. Nodes & countries column renames (FK targets follow table rename)
-- ---------------------------------------------------------------------------

ALTER TABLE public.nodes RENAME COLUMN province_id TO county_id;
ALTER TABLE public.nodes RENAME CONSTRAINT nodes_province_id_fkey TO fk_nodes_county_id;

ALTER TABLE public.countries RENAME COLUMN capital_province_id TO capital_county_id;
ALTER TABLE public.countries RENAME CONSTRAINT countries_capital_province_id_fkey TO countries_capital_county_id_fkey;

-- ---------------------------------------------------------------------------
-- 4. De jure link from county → duchy
-- ---------------------------------------------------------------------------

ALTER TABLE public.counties
  ADD COLUMN de_jure_duchy_id int REFERENCES public.duchies(id);

-- ---------------------------------------------------------------------------
-- 5. Capital-of links (child level below)
-- ---------------------------------------------------------------------------

ALTER TABLE public.duchies
  ADD CONSTRAINT fk_duchies_capital_county
  FOREIGN KEY (capital_county_id) REFERENCES public.counties(id);

ALTER TABLE public.kingdoms
  ADD CONSTRAINT fk_kingdoms_capital_duchy
  FOREIGN KEY (capital_duchy_id) REFERENCES public.duchies(id);

ALTER TABLE public.empires
  ADD CONSTRAINT fk_empires_capital_kingdom
  FOREIGN KEY (capital_kingdom_id) REFERENCES public.kingdoms(id);

-- ---------------------------------------------------------------------------
-- 6. RLS + read grants for API (anon / authenticated)
-- ---------------------------------------------------------------------------

ALTER TABLE public.empires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kingdoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duchies ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.empires TO anon, authenticated;
GRANT SELECT ON TABLE public.kingdoms TO anon, authenticated;
GRANT SELECT ON TABLE public.duchies TO anon, authenticated;

CREATE POLICY world_empires_read
  ON public.empires FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY world_kingdoms_read
  ON public.kingdoms FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY world_duchies_read
  ON public.duchies FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "world_provinces_read" ON public.counties;
CREATE POLICY world_counties_read
  ON public.counties FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 7. Map editor RPCs (replace 019 names / province wording)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.map_editor_delete_node(p_node_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_node_id IS NULL OR p_node_id < 1 THEN
    RAISE EXCEPTION 'invalid node id';
  END IF;

  DELETE FROM node_connections
  WHERE node_a_id = p_node_id OR node_b_id = p_node_id;

  UPDATE counties SET capital_node_id = NULL WHERE capital_node_id = p_node_id;

  UPDATE characters SET node_id = NULL WHERE node_id = p_node_id;

  UPDATE cities SET node_id = NULL WHERE node_id = p_node_id;

  UPDATE armies SET node_id = NULL WHERE node_id = p_node_id;

  DELETE FROM battle_orders WHERE target_node_id = p_node_id;

  DELETE FROM locations WHERE node_id = p_node_id;

  DELETE FROM nodes WHERE id = p_node_id;
END;
$$;

REVOKE ALL ON FUNCTION public.map_editor_delete_node(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_editor_delete_node(int) TO service_role;

DROP FUNCTION IF EXISTS public.map_editor_delete_province(int);

CREATE OR REPLACE FUNCTION public.map_editor_delete_county(p_county_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_county_id IS NULL OR p_county_id < 1 THEN
    RAISE EXCEPTION 'invalid county id';
  END IF;

  UPDATE nodes SET county_id = NULL WHERE county_id = p_county_id;

  UPDATE countries SET capital_county_id = NULL
  WHERE capital_county_id = p_county_id;

  UPDATE duchies SET capital_county_id = NULL
  WHERE capital_county_id = p_county_id;

  DELETE FROM counties WHERE id = p_county_id;
END;
$$;

REVOKE ALL ON FUNCTION public.map_editor_delete_county(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_editor_delete_county(int) TO service_role;
