-- Imperium — Migration 019: admin map editor — safe delete node / province
--
-- Invoked only via service_role (Next admin server actions). Cleans up known FKs
-- before deleting a node; nulls nodes on province before deleting a province.

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

  UPDATE provinces SET capital_node_id = NULL WHERE capital_node_id = p_node_id;

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

CREATE OR REPLACE FUNCTION public.map_editor_delete_province(p_province_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_province_id IS NULL OR p_province_id < 1 THEN
    RAISE EXCEPTION 'invalid province id';
  END IF;

  UPDATE nodes SET province_id = NULL WHERE province_id = p_province_id;

  UPDATE countries SET capital_province_id = NULL
  WHERE capital_province_id = p_province_id;

  DELETE FROM provinces WHERE id = p_province_id;
END;
$$;

REVOKE ALL ON FUNCTION public.map_editor_delete_province(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_editor_delete_province(int) TO service_role;
