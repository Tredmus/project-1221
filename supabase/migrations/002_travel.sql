-- ================================================================
-- Imperium — Migration 002: travel & atomic AP spending
-- ================================================================
-- Run AFTER 001_initial.sql.
--
-- Adds a single SECURITY DEFINER function that, in one locked
-- transaction:
--   1. Acquires a row-level lock on the character row.
--   2. Verifies action_points >= p_ap_cost.
--   3. Moves the character to the target node.
--   4. Deducts AP.
--   5. Inserts an append-only game_event row.
--
-- Using FOR UPDATE + UPDATE in the same transaction means no
-- other concurrent request can interleave between the check and
-- the deduction — the classic TOCTOU hole is eliminated.
--
-- The function is intentionally narrow: it does NOT validate that
-- the path exists or that the node is reachable. That validation
-- is the Server Action's responsibility before calling here.
-- ================================================================

CREATE OR REPLACE FUNCTION public.spend_ap_and_travel(
  p_character_id  uuid,
  p_target_node_id int,
  p_ap_cost       int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_ap   int;
  v_current_node int;
BEGIN
  -- Lock the row so concurrent requests can't race through the
  -- AP-sufficiency check simultaneously.
  SELECT action_points, node_id
  INTO   v_current_ap, v_current_node
  FROM   characters
  WHERE  id = p_character_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'character_not_found');
  END IF;

  IF p_ap_cost < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_ap_cost');
  END IF;

  IF v_current_ap < p_ap_cost THEN
    RETURN jsonb_build_object(
      'ok',       false,
      'error',    'insufficient_ap',
      'ap',       v_current_ap,
      'required', p_ap_cost
    );
  END IF;

  UPDATE characters
  SET    action_points = action_points - p_ap_cost,
         node_id       = p_target_node_id
  WHERE  id = p_character_id;

  -- Append-only audit. The trigger on game_events blocks UPDATE/DELETE.
  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (
    p_character_id,
    'traveled',
    jsonb_build_object(
      'from_node', v_current_node,
      'to_node',   p_target_node_id,
      'ap_spent',  p_ap_cost
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'ap_remaining', v_current_ap - p_ap_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.spend_ap_and_travel(uuid, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.spend_ap_and_travel(uuid, int, int)
  TO authenticated, service_role;
