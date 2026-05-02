-- ================================================================
-- Imperium — Migration 005: clan invitations & RPCs
-- ================================================================
-- Run AFTER 004_nightly_setup.sql.
--
-- New table:
--   clan_invitations  — pending / accepted / declined invites
--
-- New functions:
--   create_clan              — found a new clan (leader only, checks name/tag uniqueness)
--   invite_to_clan           — leader/officer sends invite by character name
--   accept_clan_invite       — invited character joins
--   decline_clan_invite      — invited character declines
--   leave_clan               — member or leader leaves; disbands if last member
--   deposit_to_clan_treasury — character moves coins to clan pool
-- ================================================================

-- ----------------------------------------------------------------
-- clan_invitations
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clan_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id       uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  invited_by    uuid NOT NULL REFERENCES characters(id),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clan_id, character_id)   -- no duplicate pending invites
);

CREATE INDEX IF NOT EXISTS clan_invitations_character_idx
  ON clan_invitations(character_id, status);
CREATE INDEX IF NOT EXISTS clan_invitations_clan_idx
  ON clan_invitations(clan_id, status);

ALTER TABLE clan_invitations ENABLE ROW LEVEL SECURITY;

-- Invitees see invitations addressed to them.
-- Clan members (including leader) see outgoing invitations for their clan.
CREATE POLICY "clan_invitations_read" ON clan_invitations
  FOR SELECT USING (
    character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
    OR clan_id IN (SELECT clan_id FROM characters WHERE user_id = auth.uid())
  );

-- ================================================================
-- 1. create_clan
-- ================================================================
CREATE OR REPLACE FUNCTION public.create_clan(
  p_leader_id  uuid,
  p_name       text,
  p_tag        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clan_id uuid;
  v_clean_name text := trim(p_name);
  v_clean_tag  text := upper(trim(p_tag));
BEGIN
  IF length(v_clean_name) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_too_short');
  END IF;
  IF length(v_clean_tag) < 2 OR length(v_clean_tag) > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tag_invalid_length');
  END IF;

  -- Guard: leader must exist and not already be in a clan.
  IF NOT EXISTS (SELECT 1 FROM characters WHERE id = p_leader_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'character_not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM characters WHERE id = p_leader_id AND clan_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_in_clan');
  END IF;

  -- Guard: name and tag must be unique.
  IF EXISTS (SELECT 1 FROM clans WHERE lower(name) = lower(v_clean_name)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_taken');
  END IF;
  IF EXISTS (SELECT 1 FROM clans WHERE tag = v_clean_tag) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tag_taken');
  END IF;

  -- Create the clan.
  INSERT INTO clans (name, tag, leader_id)
  VALUES (v_clean_name, v_clean_tag, p_leader_id)
  RETURNING id INTO v_clan_id;

  -- Promote the founder to leader.
  UPDATE characters
  SET clan_id = v_clan_id, clan_role = 'leader'
  WHERE id = p_leader_id;

  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (p_leader_id, 'clan_founded',
    jsonb_build_object('clan_id', v_clan_id, 'name', v_clean_name, 'tag', v_clean_tag));

  RETURN jsonb_build_object('ok', true, 'clan_id', v_clan_id);
END;
$$;

REVOKE ALL  ON FUNCTION public.create_clan(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_clan(uuid, text, text)
  TO authenticated, service_role;

-- ================================================================
-- 2. invite_to_clan   (find target by exact character name)
-- ================================================================
CREATE OR REPLACE FUNCTION public.invite_to_clan(
  p_inviter_id  uuid,
  p_target_name text,
  p_clan_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inviter_role text;
  v_target_id    uuid;
BEGIN
  -- Check inviter is leader or officer in this clan.
  SELECT clan_role INTO v_inviter_role
  FROM   characters
  WHERE  id = p_inviter_id AND clan_id = p_clan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_clan');
  END IF;
  IF v_inviter_role NOT IN ('leader', 'officer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_role');
  END IF;

  -- Find target by name.
  SELECT id INTO v_target_id
  FROM   characters
  WHERE  lower(name) = lower(trim(p_target_name));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'character_not_found');
  END IF;
  IF v_target_id = p_inviter_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_invite_self');
  END IF;
  IF EXISTS (SELECT 1 FROM characters WHERE id = v_target_id AND clan_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_already_in_clan');
  END IF;

  -- Upsert the invitation (re-invite after a decline is fine).
  INSERT INTO clan_invitations (clan_id, character_id, invited_by, status)
  VALUES (p_clan_id, v_target_id, p_inviter_id, 'pending')
  ON CONFLICT (clan_id, character_id)
  DO UPDATE SET status = 'pending', invited_by = p_inviter_id, created_at = now();

  -- Notify the target.
  INSERT INTO notifications (character_id, type, payload)
  SELECT v_target_id, 'clan_invite',
    jsonb_build_object(
      'clan_id',   p_clan_id,
      'clan_name', c.name,
      'clan_tag',  c.tag
    )
  FROM clans c WHERE c.id = p_clan_id;

  RETURN jsonb_build_object('ok', true, 'target_id', v_target_id);
END;
$$;

REVOKE ALL  ON FUNCTION public.invite_to_clan(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_to_clan(uuid, text, uuid)
  TO authenticated, service_role;

-- ================================================================
-- 3. accept_clan_invite
-- ================================================================
CREATE OR REPLACE FUNCTION public.accept_clan_invite(
  p_character_id  uuid,
  p_invite_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clan_id   uuid;
  v_clan_name text;
  v_leader_id uuid;
BEGIN
  -- Check the character is not already in a clan.
  IF EXISTS (SELECT 1 FROM characters WHERE id = p_character_id AND clan_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_in_clan');
  END IF;

  -- Lock and fetch the invitation.
  SELECT ci.clan_id INTO v_clan_id
  FROM   clan_invitations ci
  WHERE  ci.id = p_invite_id
  AND    ci.character_id = p_character_id
  AND    ci.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invite_not_found');
  END IF;

  SELECT name, leader_id INTO v_clan_name, v_leader_id FROM clans WHERE id = v_clan_id;

  -- Accept the invite.
  UPDATE clan_invitations SET status = 'accepted' WHERE id = p_invite_id;

  -- Join the clan.
  UPDATE characters
  SET    clan_id = v_clan_id, clan_role = 'member'
  WHERE  id = p_character_id;

  -- Notify the clan leader.
  INSERT INTO notifications (character_id, type, payload)
  SELECT v_leader_id, 'member_joined',
    jsonb_build_object(
      'character_id',   p_character_id,
      'character_name', c.name,
      'clan_name',      v_clan_name
    )
  FROM characters c WHERE c.id = p_character_id;

  RETURN jsonb_build_object('ok', true, 'clan_id', v_clan_id, 'clan_name', v_clan_name);
END;
$$;

REVOKE ALL  ON FUNCTION public.accept_clan_invite(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_clan_invite(uuid, uuid)
  TO authenticated, service_role;

-- ================================================================
-- 4. decline_clan_invite
-- ================================================================
CREATE OR REPLACE FUNCTION public.decline_clan_invite(
  p_character_id  uuid,
  p_invite_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE clan_invitations
  SET    status = 'declined'
  WHERE  id            = p_invite_id
  AND    character_id  = p_character_id
  AND    status        = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invite_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL  ON FUNCTION public.decline_clan_invite(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_clan_invite(uuid, uuid)
  TO authenticated, service_role;

-- ================================================================
-- 5. leave_clan
--    If the leaver is the last member, disbands the clan.
--    If the leaver is the leader, promotes the longest-standing member.
-- ================================================================
CREATE OR REPLACE FUNCTION public.leave_clan(
  p_character_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clan_id       uuid;
  v_clan_name     text;
  v_role          text;
  v_member_count  int;
  v_new_leader_id uuid;
BEGIN
  SELECT clan_id, clan_role INTO v_clan_id, v_role
  FROM   characters
  WHERE  id = p_character_id
  FOR UPDATE;

  IF v_clan_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_clan');
  END IF;

  SELECT name INTO v_clan_name FROM clans WHERE id = v_clan_id;

  -- Count other members.
  SELECT count(*) INTO v_member_count
  FROM   characters
  WHERE  clan_id = v_clan_id AND id <> p_character_id;

  IF v_member_count = 0 THEN
    -- Last member: disband. Clear all references first to avoid FK violations.
    UPDATE characters SET clan_id = NULL, clan_role = NULL WHERE clan_id = v_clan_id;
    DELETE FROM clans WHERE id = v_clan_id;
    RETURN jsonb_build_object('ok', true, 'disbanded', true, 'clan_name', v_clan_name);
  END IF;

  IF v_role = 'leader' THEN
    -- Pick the longest-standing member to become the new leader.
    SELECT id INTO v_new_leader_id
    FROM   characters
    WHERE  clan_id = v_clan_id AND id <> p_character_id
    ORDER  BY created_at
    LIMIT  1;

    UPDATE clans      SET leader_id = v_new_leader_id          WHERE id = v_clan_id;
    UPDATE characters SET clan_role = 'leader'                 WHERE id = v_new_leader_id;

    -- Notify new leader.
    INSERT INTO notifications (character_id, type, payload)
    VALUES (v_new_leader_id, 'promoted_leader',
      jsonb_build_object('clan_id', v_clan_id, 'clan_name', v_clan_name));
  END IF;

  -- Remove the leaver.
  UPDATE characters SET clan_id = NULL, clan_role = NULL WHERE id = p_character_id;

  RETURN jsonb_build_object('ok', true, 'disbanded', false, 'clan_name', v_clan_name);
END;
$$;

REVOKE ALL  ON FUNCTION public.leave_clan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_clan(uuid)
  TO authenticated, service_role;

-- ================================================================
-- 6. deposit_to_clan_treasury
--    Atomic: deduct from character.coins, add to clan.treasury_gold.
-- ================================================================
CREATE OR REPLACE FUNCTION public.deposit_to_clan_treasury(
  p_character_id uuid,
  p_amount       numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clan_id uuid;
  v_coins   numeric;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_must_be_positive');
  END IF;

  SELECT clan_id, coins INTO v_clan_id, v_coins
  FROM   characters
  WHERE  id = p_character_id
  FOR UPDATE;

  IF v_clan_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_clan');
  END IF;
  IF v_coins < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_funds',
      'have', v_coins, 'required', p_amount);
  END IF;

  UPDATE characters  SET coins = coins - p_amount WHERE id = p_character_id;
  UPDATE clans       SET treasury_gold = treasury_gold + p_amount WHERE id = v_clan_id;

  INSERT INTO ledger_entries (character_id, delta, reason, ref_type, ref_id)
  VALUES (p_character_id, -p_amount, 'clan_deposit', 'clan', v_clan_id::text);

  RETURN jsonb_build_object('ok', true, 'deposited', p_amount,
    'remaining_coins', v_coins - p_amount);
END;
$$;

REVOKE ALL  ON FUNCTION public.deposit_to_clan_treasury(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deposit_to_clan_treasury(uuid, numeric)
  TO authenticated, service_role;
