-- ================================================================
-- Imperium — Migration 003: economy functions & building seed
-- ================================================================
-- Run AFTER 002_travel.sql.
--
-- Functions created here:
--   1. add_to_inventory          — helper: UPSERT-increment inventory
--   2. queue_work_action         — atomic AP spend + work queue insert
--   3. process_single_work_action — nightly cron: deliver output + wages
--   4. create_market_listing     — atomic escrow + order create
--   5. fill_market_order         — atomic buy (coins + items)
--   6. cancel_market_order       — return escrowed items to seller
--
-- All functions are SECURITY DEFINER with minimal GRANT surface.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. add_to_inventory
--    Safe UPSERT-increment. Zero or negative qty is a no-op.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_to_inventory(
  p_character_id  uuid,
  p_item_type_id  text,
  p_quantity      numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_quantity <= 0 THEN RETURN; END IF;

  INSERT INTO inventory (character_id, item_type_id, quantity)
  VALUES (p_character_id, p_item_type_id, p_quantity)
  ON CONFLICT (character_id, item_type_id)
  DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity;
END;
$$;

REVOKE ALL  ON FUNCTION public.add_to_inventory(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_to_inventory(uuid, text, numeric)
  TO service_role;

-- ----------------------------------------------------------------
-- 2. queue_work_action
--    Atomically deducts AP and creates a work_action row.
--    The character must be in the same node as the building's city.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_work_action(
  p_character_id  uuid,
  p_building_id   int,
  p_ap_to_spend   int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_char_ap       int;
  v_char_node     int;
  v_city_node     int;
  v_work_id       uuid;
BEGIN
  IF p_ap_to_spend <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ap_must_be_positive');
  END IF;

  -- Lock the character row.
  SELECT action_points, node_id
  INTO   v_char_ap, v_char_node
  FROM   characters
  WHERE  id = p_character_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'character_not_found');
  END IF;

  IF v_char_ap < p_ap_to_spend THEN
    RETURN jsonb_build_object(
      'ok',       false,
      'error',    'insufficient_ap',
      'ap',       v_char_ap,
      'required', p_ap_to_spend
    );
  END IF;

  -- Verify the character is at the building's city node.
  SELECT cities.node_id INTO v_city_node
  FROM city_buildings
  JOIN cities ON cities.id = city_buildings.city_id
  WHERE city_buildings.id = p_building_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'building_not_found');
  END IF;

  IF v_char_node IS NULL OR v_char_node <> v_city_node THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_at_this_city');
  END IF;

  -- Deduct AP.
  UPDATE characters
  SET    action_points = action_points - p_ap_to_spend
  WHERE  id = p_character_id;

  -- Queue the work action.
  INSERT INTO work_actions (character_id, building_id, ap_spent)
  VALUES (p_character_id, p_building_id, p_ap_to_spend)
  RETURNING id INTO v_work_id;

  -- Audit.
  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (
    p_character_id,
    'worked',
    jsonb_build_object(
      'building_id', p_building_id,
      'ap_spent',    p_ap_to_spend,
      'work_id',     v_work_id
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'work_id',     v_work_id,
    'ap_remaining', v_char_ap - p_ap_to_spend
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.queue_work_action(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_work_action(uuid, int, int)
  TO authenticated, service_role;

-- ----------------------------------------------------------------
-- 3. process_single_work_action
--    Nightly cron calls this once per pending work_action row.
--    Runs in its own transaction so one failure doesn't block others.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_single_work_action(
  p_work_action_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_char_id       uuid;
  v_ap_spent      int;
  v_output_item   text;
  v_output_qty    numeric;
  v_wage          numeric;
  v_output_total  numeric;
  v_wage_total    numeric;
BEGIN
  -- Lock the row to prevent double-processing.
  SELECT wa.character_id,
         wa.ap_spent,
         bt.output_item_id,
         bt.output_qty_per_ap,
         bt.wage_per_ap
  INTO   v_char_id, v_ap_spent, v_output_item, v_output_qty, v_wage
  FROM   work_actions  wa
  JOIN   city_buildings cb ON cb.id = wa.building_id
  JOIN   building_types bt ON bt.id = cb.building_type_id
  WHERE  wa.id = p_work_action_id
  AND    wa.processed_at IS NULL
  FOR UPDATE OF wa;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_already_processed');
  END IF;

  v_output_total := v_ap_spent * COALESCE(v_output_qty, 0);
  v_wage_total   := v_ap_spent * COALESCE(v_wage, 0);

  -- Deliver output items to inventory.
  IF v_output_item IS NOT NULL AND v_output_total > 0 THEN
    PERFORM add_to_inventory(v_char_id, v_output_item, v_output_total);
  END IF;

  -- Pay wage: system → character (no sender, coins minted from thin air for MVP).
  IF v_wage_total > 0 THEN
    PERFORM transfer_coins(
      NULL, v_char_id, v_wage_total,
      'wage', 'work_action', p_work_action_id::text
    );
  END IF;

  -- Mark processed.
  UPDATE work_actions
  SET    processed_at = now()
  WHERE  id = p_work_action_id;

  -- Send a notification to the character.
  INSERT INTO notifications (character_id, type, payload)
  VALUES (
    v_char_id,
    'work_processed',
    jsonb_build_object(
      'work_action_id', p_work_action_id,
      'ap_spent',       v_ap_spent,
      'item_earned',    v_output_item,
      'qty_earned',     v_output_total,
      'coins_earned',   v_wage_total
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'item_earned', v_output_item,
    'qty_earned',  v_output_total,
    'coins_earned', v_wage_total
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.process_single_work_action(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_single_work_action(uuid)
  TO service_role;

-- ----------------------------------------------------------------
-- 4. create_market_listing
--    Escrows items from seller inventory and creates an open order.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_market_listing(
  p_seller_id      uuid,
  p_city_id        int,
  p_item_type_id   text,
  p_quantity       numeric,
  p_price_per_unit numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_qty  numeric;
  v_order_id     uuid;
  v_char_node    int;
  v_city_node    int;
BEGIN
  IF p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quantity_must_be_positive');
  END IF;
  IF p_price_per_unit < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'price_cannot_be_negative');
  END IF;

  -- Verify seller is in the city.
  SELECT characters.node_id INTO v_char_node
  FROM characters WHERE id = p_seller_id;

  SELECT node_id INTO v_city_node FROM cities WHERE id = p_city_id;

  IF v_char_node IS NULL OR v_char_node <> v_city_node THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_at_this_city');
  END IF;

  -- Lock and check inventory.
  SELECT quantity INTO v_current_qty
  FROM   inventory
  WHERE  character_id = p_seller_id AND item_type_id = p_item_type_id
  FOR UPDATE;

  IF v_current_qty IS NULL OR v_current_qty < p_quantity THEN
    RETURN jsonb_build_object(
      'ok',       false,
      'error',    'insufficient_inventory',
      'have',     COALESCE(v_current_qty, 0),
      'required', p_quantity
    );
  END IF;

  -- Escrow: deduct from inventory.
  UPDATE inventory
  SET    quantity = quantity - p_quantity
  WHERE  character_id = p_seller_id AND item_type_id = p_item_type_id;

  -- Remove zero-quantity rows to keep the table clean.
  DELETE FROM inventory
  WHERE  character_id = p_seller_id
  AND    item_type_id = p_item_type_id
  AND    quantity = 0;

  -- Create the listing.
  INSERT INTO market_orders
    (seller_id, city_id, item_type_id, quantity, price_per_unit, status)
  VALUES
    (p_seller_id, p_city_id, p_item_type_id, p_quantity, p_price_per_unit, 'open')
  RETURNING id INTO v_order_id;

  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (
    p_seller_id, 'listed_item',
    jsonb_build_object(
      'order_id',       v_order_id,
      'item_type_id',   p_item_type_id,
      'quantity',       p_quantity,
      'price_per_unit', p_price_per_unit
    )
  );

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id);
END;
$$;

REVOKE ALL  ON FUNCTION public.create_market_listing(uuid, int, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_market_listing(uuid, int, text, numeric, numeric)
  TO authenticated, service_role;

-- ----------------------------------------------------------------
-- 5. fill_market_order
--    Buyer purchases up to the full remaining quantity.
--    Coins flow buyer → seller; items flow listing → buyer inventory.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_market_order(
  p_buyer_id  uuid,
  p_order_id  uuid,
  p_quantity  numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_id     uuid;
  v_item_type_id  text;
  v_remaining     numeric;
  v_price         numeric;
  v_total_coins   numeric;
  v_new_qty       numeric;
BEGIN
  IF p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quantity_must_be_positive');
  END IF;

  -- Lock the order row.
  SELECT seller_id, item_type_id, quantity, price_per_unit
  INTO   v_seller_id, v_item_type_id, v_remaining, v_price
  FROM   market_orders
  WHERE  id = p_order_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found_or_closed');
  END IF;

  IF p_buyer_id = v_seller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_buy_own_listing');
  END IF;

  IF p_quantity > v_remaining THEN
    RETURN jsonb_build_object(
      'ok',        false,
      'error',     'quantity_exceeds_listing',
      'available', v_remaining
    );
  END IF;

  v_total_coins := p_quantity * v_price;

  -- Transfer coins buyer → seller (transfer_coins checks buyer balance).
  PERFORM transfer_coins(
    p_buyer_id, v_seller_id, v_total_coins,
    'market_buy', 'market_order', p_order_id::text
  );

  -- Deliver items to buyer.
  PERFORM add_to_inventory(p_buyer_id, v_item_type_id, p_quantity);

  -- Decrement order quantity; close if exhausted.
  v_new_qty := v_remaining - p_quantity;
  IF v_new_qty = 0 THEN
    UPDATE market_orders SET quantity = 0, status = 'filled' WHERE id = p_order_id;
  ELSE
    UPDATE market_orders SET quantity = v_new_qty WHERE id = p_order_id;
  END IF;

  INSERT INTO game_events (actor_id, event_type, payload)
  VALUES (
    p_buyer_id, 'bought_item',
    jsonb_build_object(
      'order_id',     p_order_id,
      'item_type_id', v_item_type_id,
      'quantity',     p_quantity,
      'total_coins',  v_total_coins
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'coins_spent', v_total_coins,
    'items_gained', p_quantity
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.fill_market_order(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fill_market_order(uuid, uuid, numeric)
  TO authenticated, service_role;

-- ----------------------------------------------------------------
-- 6. cancel_market_order
--    Returns the remaining escrowed quantity to the seller.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_market_order(
  p_character_id uuid,
  p_order_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item_type_id  text;
  v_remaining     numeric;
BEGIN
  -- Lock and verify ownership.
  SELECT item_type_id, quantity
  INTO   v_item_type_id, v_remaining
  FROM   market_orders
  WHERE  id = p_order_id
  AND    seller_id = p_character_id
  AND    status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found_or_not_yours');
  END IF;

  -- Mark cancelled.
  UPDATE market_orders SET status = 'cancelled' WHERE id = p_order_id;

  -- Refund remaining escrowed items.
  IF v_remaining > 0 THEN
    PERFORM add_to_inventory(p_character_id, v_item_type_id, v_remaining);
  END IF;

  RETURN jsonb_build_object('ok', true, 'returned_qty', v_remaining);
END;
$$;

REVOKE ALL  ON FUNCTION public.cancel_market_order(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_market_order(uuid, uuid)
  TO authenticated, service_role;

-- ================================================================
-- SEED: city_buildings for the three starting cities
-- Safe to run multiple times (skips if buildings already exist).
-- ================================================================

INSERT INTO city_buildings (city_id, building_type_id, owner_id, level)
SELECT c.id, bt.id, NULL, 1
FROM   cities c
CROSS  JOIN (VALUES
    ('sawmill'), ('forge'), ('bakery'), ('tavern')
  ) AS bt(id)
WHERE  c.name = 'Constantinople'
AND    NOT EXISTS (
  SELECT 1 FROM city_buildings cb
  WHERE  cb.city_id = c.id AND cb.building_type_id = bt.id
);

INSERT INTO city_buildings (city_id, building_type_id, owner_id, level)
SELECT c.id, bt.id, NULL, 1
FROM   cities c
CROSS  JOIN (VALUES
    ('sawmill'), ('bakery'), ('quarry')
  ) AS bt(id)
WHERE  c.name = 'Adrianople'
AND    NOT EXISTS (
  SELECT 1 FROM city_buildings cb
  WHERE  cb.city_id = c.id AND cb.building_type_id = bt.id
);

INSERT INTO city_buildings (city_id, building_type_id, owner_id, level)
SELECT c.id, bt.id, NULL, 1
FROM   cities c
CROSS  JOIN (VALUES
    ('sawmill'), ('forge'), ('bakery'), ('tavern')
  ) AS bt(id)
WHERE  c.name = 'Thessaloniki'
AND    NOT EXISTS (
  SELECT 1 FROM city_buildings cb
  WHERE  cb.city_id = c.id AND cb.building_type_id = bt.id
);
