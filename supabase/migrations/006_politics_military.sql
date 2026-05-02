-- ================================================================
-- Imperium — Migration 006: politics & military RPCs
-- ================================================================
-- Run AFTER 005_clans.sql.
--
-- New functions:
--   open_election       — any char in scope can start an election
--   cast_vote           — vote in an open election
--   close_election      — tally votes, install officeholder, notify
--   process_elections   — called by nightly cron (closes expired)
--   recruit_soldiers    — spend coins → create/grow army
--   march_army          — move army to an adjacent node (no AP cost)
-- ================================================================

-- ================================================================
-- 1. open_election
--    A character in the relevant city / region opens an election.
--    Only one open election per position+scope at a time.
-- ================================================================
CREATE OR REPLACE FUNCTION public.open_election(
  p_character_id  uuid,
  p_position_id   text,
  p_scope_id      int,
  p_closes_hours  int DEFAULT 24
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_election_id uuid;
  v_position    record;
  v_scope       text;
BEGIN
  -- Validate position.
  SELECT scope INTO v_position FROM positions WHERE id = p_position_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'position_not_found');
  END IF;

  -- Guard: no open election for this slot already.
  IF EXISTS (
    SELECT 1 FROM elections
    WHERE  position_id = p_position_id
    AND    scope_id    = p_scope_id
    AND    status      = 'open'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'election_already_open');
  END IF;

  -- Validate character exists and is eligible (no further constraints for MVP).
  IF NOT EXISTS (SELECT 1 FROM characters WHERE id = p_character_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'character_not_found');
  END IF;

  INSERT INTO elections (position_id, scope_id, status, closes_at)
  VALUES (
    p_position_id,
    p_scope_id,
    'open',
    now() + (p_closes_hours || ' hours')::interval
  )
  RETURNING id INTO v_election_id;

  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (p_character_id, 'election_opened',
    jsonb_build_object(
      'election_id', v_election_id,
      'position_id', p_position_id,
      'scope_id',    p_scope_id
    ));

  RETURN jsonb_build_object('ok', true, 'election_id', v_election_id);
END;
$$;

REVOKE ALL  ON FUNCTION public.open_election(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_election(uuid, text, int, int)
  TO authenticated, service_role;

-- ================================================================
-- 2. cast_vote
--    Character votes once per election. Can vote for any character
--    (including self). Voting requires the character be in scope
--    (city_id / province_id checks omitted for MVP — trusting RLS).
-- ================================================================
CREATE OR REPLACE FUNCTION public.cast_vote(
  p_voter_id      uuid,
  p_election_id   uuid,
  p_candidate_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Check election is open.
  IF NOT EXISTS (
    SELECT 1 FROM elections WHERE id = p_election_id AND status = 'open'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'election_not_open');
  END IF;

  -- Check candidate exists.
  IF NOT EXISTS (SELECT 1 FROM characters WHERE id = p_candidate_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'candidate_not_found');
  END IF;

  -- Check voter hasn't already voted.
  IF EXISTS (SELECT 1 FROM votes WHERE election_id = p_election_id AND voter_id = p_voter_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_voted');
  END IF;

  INSERT INTO votes (election_id, voter_id, candidate_id)
  VALUES (p_election_id, p_voter_id, p_candidate_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL  ON FUNCTION public.cast_vote(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_vote(uuid, uuid, uuid)
  TO authenticated, service_role;

-- ================================================================
-- 3. close_election
--    Tally votes → winner gets an officeholder row.
--    On a tie, the character who created their account first wins.
--    Called directly by process_elections.
-- ================================================================
CREATE OR REPLACE FUNCTION public.close_election(
  p_election_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_election     record;
  v_winner_id    uuid;
  v_vote_count   int;
  v_term_days    int;
  v_holder_id    uuid;
BEGIN
  SELECT e.*, p.term_days, p.scope
  INTO   v_election
  FROM   elections e
  JOIN   positions p ON p.id = e.position_id
  WHERE  e.id = p_election_id AND e.status = 'open';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'election_not_found_or_closed');
  END IF;

  -- Mark closed first (prevents double-processing).
  UPDATE elections SET status = 'closed' WHERE id = p_election_id;

  -- Find winner: most votes, tie-break by character created_at (oldest wins).
  SELECT v.candidate_id, count(*) AS cnt
  INTO   v_winner_id, v_vote_count
  FROM   votes v
  WHERE  v.election_id = p_election_id
  GROUP  BY v.candidate_id
  ORDER  BY cnt DESC,
            (SELECT created_at FROM characters WHERE id = v.candidate_id) ASC
  LIMIT  1;

  IF v_winner_id IS NULL THEN
    -- No votes cast: election closes with no winner.
    RETURN jsonb_build_object('ok', true, 'winner', null, 'note', 'no_votes');
  END IF;

  -- Install officeholder.
  INSERT INTO officeholders (character_id, position_id, scope_id, term_start, term_end)
  VALUES (
    v_winner_id,
    v_election.position_id,
    v_election.scope_id,
    current_date,
    current_date + v_election.term_days
  )
  RETURNING id INTO v_holder_id;

  -- Notify the winner.
  INSERT INTO notifications (character_id, type, payload)
  VALUES (v_winner_id, 'election_won',
    jsonb_build_object(
      'election_id',  p_election_id,
      'position_id',  v_election.position_id,
      'scope_id',     v_election.scope_id,
      'votes',        v_vote_count,
      'term_end',     (current_date + v_election.term_days)::text
    ));

  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (v_winner_id, 'election_won',
    jsonb_build_object(
      'election_id',  p_election_id,
      'position_id',  v_election.position_id,
      'scope_id',     v_election.scope_id,
      'votes',        v_vote_count
    ));

  RETURN jsonb_build_object(
    'ok',        true,
    'winner_id', v_winner_id,
    'votes',     v_vote_count,
    'holder_id', v_holder_id
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.close_election(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_election(uuid)
  TO service_role;

-- ================================================================
-- 4. process_elections
--    Closes all elections whose closes_at has passed.
--    Called by the nightly Edge Function.
-- ================================================================
CREATE OR REPLACE FUNCTION public.process_elections()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_election record;
  v_closed   int := 0;
BEGIN
  FOR v_election IN
    SELECT id FROM elections
    WHERE  status = 'open' AND closes_at <= now()
  LOOP
    PERFORM close_election(v_election.id);
    v_closed := v_closed + 1;
  END LOOP;

  RETURN jsonb_build_object('closed', v_closed);
END;
$$;

REVOKE ALL  ON FUNCTION public.process_elections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_elections() TO service_role;

-- ================================================================
-- 5. recruit_soldiers
--    Spend coins to grow your army (create army row if none exists).
--    Cost: 5 coins per soldier (configurable via properties in future).
-- ================================================================
CREATE OR REPLACE FUNCTION public.recruit_soldiers(
  p_character_id uuid,
  p_count        int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cost     numeric;
  v_coins    numeric;
  v_node_id  int;
  v_army_id  uuid;
BEGIN
  IF p_count <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'count_must_be_positive');
  END IF;

  v_cost := p_count * 5;

  SELECT coins, node_id INTO v_coins, v_node_id
  FROM   characters WHERE id = p_character_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'character_not_found');
  END IF;

  IF v_coins < v_cost THEN
    RETURN jsonb_build_object(
      'ok',       false,
      'error',    'insufficient_funds',
      'have',     v_coins,
      'required', v_cost
    );
  END IF;

  -- Deduct coins and log to ledger.
  UPDATE characters SET coins = coins - v_cost WHERE id = p_character_id;
  INSERT INTO ledger_entries (character_id, delta, reason, ref_type)
  VALUES (p_character_id, -v_cost, 'recruit_soldiers', 'army');

  -- Upsert army row.
  INSERT INTO armies (character_id, node_id, soldier_count, mode)
  VALUES (p_character_id, v_node_id, p_count, 'garrison')
  ON CONFLICT (character_id)
  DO UPDATE SET
    soldier_count = armies.soldier_count + EXCLUDED.soldier_count,
    node_id       = COALESCE(armies.node_id, EXCLUDED.node_id)
  RETURNING id INTO v_army_id;

  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (p_character_id, 'recruited',
    jsonb_build_object('soldiers', p_count, 'cost', v_cost));

  RETURN jsonb_build_object(
    'ok',       true,
    'army_id',  v_army_id,
    'soldiers', p_count,
    'cost',     v_cost,
    'coins_remaining', v_coins - v_cost
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.recruit_soldiers(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recruit_soldiers(uuid, int)
  TO authenticated, service_role;

-- Armies need a unique constraint on character_id for the upsert to work.
ALTER TABLE armies ADD CONSTRAINT armies_character_unique UNIQUE (character_id);

-- ================================================================
-- 6. march_army
--    Move the character's army to an adjacent connected node.
--    Does NOT cost AP (marching is a separate resource for now).
-- ================================================================
CREATE OR REPLACE FUNCTION public.march_army(
  p_character_id   uuid,
  p_target_node_id int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_army_id      uuid;
  v_current_node int;
  v_soldiers     int;
BEGIN
  SELECT id, node_id, soldier_count INTO v_army_id, v_current_node, v_soldiers
  FROM   armies WHERE character_id = p_character_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_army');
  END IF;

  IF v_soldiers = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'army_is_empty');
  END IF;

  -- Verify adjacency (undirected connection).
  IF NOT EXISTS (
    SELECT 1 FROM node_connections
    WHERE (node_a_id = v_current_node AND node_b_id = p_target_node_id)
       OR (node_a_id = p_target_node_id AND node_b_id = v_current_node)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_adjacent');
  END IF;

  UPDATE armies
  SET    node_id = p_target_node_id,
         mode    = 'marching'
  WHERE  id = v_army_id;

  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (p_character_id, 'army_marched',
    jsonb_build_object(
      'from_node', v_current_node,
      'to_node',   p_target_node_id,
      'soldiers',  v_soldiers
    ));

  RETURN jsonb_build_object(
    'ok',        true,
    'to_node',   p_target_node_id,
    'soldiers',  v_soldiers
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.march_army(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.march_army(uuid, int)
  TO authenticated, service_role;
