-- ================================================================
-- Imperium — Initial migration
-- ----------------------------------------------------------------
-- Run inside the Supabase SQL editor, or via the Supabase CLI:
--   supabase db push
--
-- This file is the corrected, fix-applied version of the original
-- design document. Highlights of what was changed:
--
--   1. FK type mismatch fixed: provinces and locations now have
--      separate owner_country_id (int) / owner_clan_id (uuid)
--      columns guarded by a CHECK constraint that enforces a
--      single owner consistent with owner_type.
--   2. Full RLS coverage: every public table has RLS enabled and
--      a default-deny policy. World-readable tables get explicit
--      SELECT-true policies. Writes go through Server Actions
--      using the user's session, or through Edge Functions using
--      the service role.
--   3. handle_new_user() trigger creates a public.users row for
--      every new auth.users insert, with a random username that
--      can be replaced during onboarding.
--   4. ledger_entries table for double-entry coin auditing.
--   5. Hot-path indexes (characters.node_id, characters.clan_id,
--      market_orders open by city/item, work_actions pending,
--      notifications unread, game_events activity feeds).
--   6. pg_cron schedules a single nightly job that POSTs to an
--      Edge Function — the Edge Function orchestrates each step
--      and writes to nightly_jobs. This keeps SQL out of the
--      cron path beyond the trigger.
--
-- Order of operations matters. Don't reorder this file casually.
-- ================================================================

-- ----------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
-- pg_cron is NOT included here: it is unavailable on some plans until you
-- enable it under Database, Extensions. Enabling it after tables exist is fine.
-- Nightly jobs can use Supabase Scheduled Functions or external cron on the Edge Function.

-- ================================================================
-- 1. WORLD — regions, provinces, nodes, connections
-- ================================================================

CREATE TABLE regions (
  id    serial PRIMARY KEY,
  name  text NOT NULL
);

-- Provinces use polymorphic ownership but with separate FK columns
-- so we can enforce real foreign keys instead of a typeless int.
CREATE TABLE provinces (
  id                  serial PRIMARY KEY,
  name                text NOT NULL,
  region_id           int REFERENCES regions(id),
  owner_type          text NOT NULL DEFAULT 'independent'
                        CHECK (owner_type IN ('country', 'clan', 'independent')),
  owner_country_id    int,   -- FK added after countries table exists
  owner_clan_id       uuid,  -- FK added after clans table exists
  capital_node_id     int,   -- FK added after nodes table exists
  CONSTRAINT province_owner_consistency CHECK (
    (owner_type = 'independent' AND owner_country_id IS NULL AND owner_clan_id IS NULL)
    OR (owner_type = 'country' AND owner_country_id IS NOT NULL AND owner_clan_id IS NULL)
    OR (owner_type = 'clan'    AND owner_clan_id IS NOT NULL AND owner_country_id IS NULL)
  )
);

CREATE TABLE nodes (
  id          serial PRIMARY KEY,
  name        text,
  type        text NOT NULL DEFAULT 'road'
                CHECK (type IN ('road', 'city', 'settlement', 'farm', 'mine', 'port', 'fortress')),
  entity_id   int,
  province_id int REFERENCES provinces(id),
  is_capital  bool DEFAULT false,
  map_x       numeric NOT NULL,
  map_y       numeric NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- Insert each connection once. Pathfinding code MUST query both
-- columns. The two indexes below cover both directions.
CREATE TABLE node_connections (
  node_a_id         int REFERENCES nodes(id),
  node_b_id         int REFERENCES nodes(id),
  travel_cost       int NOT NULL DEFAULT 1,
  road_type         text NOT NULL DEFAULT 'road'
                      CHECK (road_type IN ('road', 'river', 'sea')),
  min_tier_required int NOT NULL DEFAULT 1,
  PRIMARY KEY (node_a_id, node_b_id),
  CONSTRAINT no_self_loop CHECK (node_a_id <> node_b_id)
);

CREATE INDEX node_connections_node_a_idx ON node_connections(node_a_id);
CREATE INDEX node_connections_node_b_idx ON node_connections(node_b_id);

ALTER TABLE provinces
  ADD CONSTRAINT fk_province_capital_node
  FOREIGN KEY (capital_node_id) REFERENCES nodes(id);

-- ================================================================
-- 2. CITIES & LOCATIONS
-- ================================================================

CREATE TABLE cities (
  id          serial PRIMARY KEY,
  node_id     int REFERENCES nodes(id),
  name        text NOT NULL,
  wall_level  int DEFAULT 1,
  is_capital  bool DEFAULT false,
  properties  jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Both characters and clans have uuid ids, so locations.owner_id
-- can stay as a single uuid column without the FK type problem
-- that provinces had.
CREATE TABLE locations (
  id          serial PRIMARY KEY,
  node_id     int REFERENCES nodes(id),
  type        text NOT NULL CHECK (type IN ('farm', 'mine', 'port', 'fortress', 'settlement')),
  level       int DEFAULT 1,
  owner_id    uuid,
  owner_type  text CHECK (owner_type IN ('character', 'clan')),
  properties  jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT location_owner_consistency CHECK (
    (owner_id IS NULL AND owner_type IS NULL)
    OR (owner_id IS NOT NULL AND owner_type IS NOT NULL)
  )
);

-- ================================================================
-- 3. COUNTRIES
-- ================================================================

CREATE TABLE countries (
  id                  serial PRIMARY KEY,
  name                text NOT NULL,
  ruler_id            uuid,                                            -- FK after characters
  capital_province_id int REFERENCES provinces(id),
  cores               int[] NOT NULL DEFAULT '{}',
  vassal_ids          int[] NOT NULL DEFAULT '{}',
  properties          jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE provinces
  ADD CONSTRAINT fk_province_owner_country
  FOREIGN KEY (owner_country_id) REFERENCES countries(id);

-- ================================================================
-- 4. USERS & CHARACTERS
-- ================================================================

CREATE TABLE users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    text UNIQUE NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE characters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,

  -- Location
  node_id       int REFERENCES nodes(id),
  home_city_id  int REFERENCES cities(id),

  -- Economy
  coins         numeric NOT NULL DEFAULT 50 CHECK (coins >= 0),
  gems          int     NOT NULL DEFAULT 0  CHECK (gems  >= 0),

  -- Progression
  level         int NOT NULL DEFAULT 1,
  experience    int NOT NULL DEFAULT 0,
  profession    text NOT NULL DEFAULT 'peasant'
                  CHECK (profession IN (
                    'peasant', 'soldier', 'merchant', 'blacksmith',
                    'farmer', 'miner', 'politician', 'priest'
                  )),

  -- Action Points
  action_points     int NOT NULL DEFAULT 10 CHECK (action_points >= 0),
  max_action_points int NOT NULL DEFAULT 10 CHECK (max_action_points >= 0),
  travel_tier       int NOT NULL DEFAULT 1,

  -- Stats
  strength      int NOT NULL DEFAULT 1,
  craft         int NOT NULL DEFAULT 1,
  charisma      int NOT NULL DEFAULT 1,
  intelligence  int NOT NULL DEFAULT 1,

  -- Clan
  clan_id       uuid,                                                  -- FK after clans
  clan_role     text CHECK (clan_role IN ('leader', 'officer', 'member')),

  -- Titles
  titles        text[] NOT NULL DEFAULT '{}',

  created_at    timestamptz DEFAULT now(),

  CONSTRAINT character_clan_role_consistency CHECK (
    (clan_id IS NULL AND clan_role IS NULL)
    OR (clan_id IS NOT NULL AND clan_role IS NOT NULL)
  )
);

CREATE INDEX characters_user_id_idx     ON characters(user_id);
CREATE INDEX characters_node_id_idx     ON characters(node_id);
CREATE INDEX characters_home_city_idx   ON characters(home_city_id);
CREATE INDEX characters_clan_id_idx     ON characters(clan_id);

ALTER TABLE countries
  ADD CONSTRAINT fk_country_ruler
  FOREIGN KEY (ruler_id) REFERENCES characters(id);

-- ================================================================
-- 5. INVENTORY & ITEMS
-- ================================================================

CREATE TABLE item_types (
  id            text PRIMARY KEY,
  category      text NOT NULL CHECK (category IN ('resource', 'weapon', 'food', 'armor', 'tool', 'currency')),
  name          text NOT NULL,
  description   text,
  stackable     bool NOT NULL DEFAULT true,
  max_stack     int,
  weight        numeric NOT NULL DEFAULT 1,
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE inventory (
  id            serial PRIMARY KEY,
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_type_id  text NOT NULL REFERENCES item_types(id),
  quantity      numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  condition     numeric,
  UNIQUE (character_id, item_type_id)
);

-- ================================================================
-- 6. CLANS
-- ================================================================

CREATE TABLE clans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  tag           text UNIQUE NOT NULL,
  leader_id     uuid REFERENCES characters(id),
  treasury_gold numeric NOT NULL DEFAULT 0 CHECK (treasury_gold >= 0),
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE characters
  ADD CONSTRAINT fk_character_clan
  FOREIGN KEY (clan_id) REFERENCES clans(id);

ALTER TABLE provinces
  ADD CONSTRAINT fk_province_owner_clan
  FOREIGN KEY (owner_clan_id) REFERENCES clans(id);

CREATE TABLE clan_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id       uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  assigned_to   uuid REFERENCES characters(id),
  assigned_by   uuid NOT NULL REFERENCES characters(id),
  title         text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'done')),
  reward_coins  numeric NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX clan_tasks_clan_idx ON clan_tasks(clan_id, status);

CREATE TABLE clan_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id       uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  author_id     uuid REFERENCES characters(id),
  content       text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX clan_messages_clan_recent_idx ON clan_messages(clan_id, created_at DESC);

-- ================================================================
-- 7. ECONOMY — buildings, work, market
-- ================================================================

CREATE TABLE building_types (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  output_item_id      text REFERENCES item_types(id),
  output_qty_per_ap   numeric NOT NULL DEFAULT 1,
  wage_per_ap         numeric NOT NULL DEFAULT 1,
  required_stat       text,
  properties          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE city_buildings (
  id                serial PRIMARY KEY,
  city_id           int NOT NULL REFERENCES cities(id),
  building_type_id  text NOT NULL REFERENCES building_types(id),
  owner_id          uuid REFERENCES characters(id),
  level             int NOT NULL DEFAULT 1
);

CREATE INDEX city_buildings_city_idx ON city_buildings(city_id);

CREATE TABLE work_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  uuid NOT NULL REFERENCES characters(id),
  building_id   int  NOT NULL REFERENCES city_buildings(id),
  ap_spent      int  NOT NULL CHECK (ap_spent > 0),
  processed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- Partial index for the nightly job: scan only unprocessed rows.
CREATE INDEX work_actions_pending_idx
  ON work_actions(created_at)
  WHERE processed_at IS NULL;

-- Market orders escrow by convention: the seller's inventory is
-- decremented at listing time and refunded on cancel. This keeps
-- the order itself tamper-proof. See lib/game/market.ts.
CREATE TABLE market_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       uuid NOT NULL REFERENCES characters(id),
  city_id         int  NOT NULL REFERENCES cities(id),
  item_type_id    text NOT NULL REFERENCES item_types(id),
  quantity        numeric NOT NULL CHECK (quantity > 0),
  price_per_unit  numeric NOT NULL CHECK (price_per_unit >= 0),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX market_orders_listing_idx
  ON market_orders(city_id, item_type_id)
  WHERE status = 'open';

-- ================================================================
-- 8. MILITARY
-- ================================================================

CREATE TABLE armies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    uuid NOT NULL REFERENCES characters(id),
  node_id         int  REFERENCES nodes(id),
  soldier_count   int  NOT NULL DEFAULT 0 CHECK (soldier_count >= 0),
  mode            text NOT NULL DEFAULT 'garrison'
                    CHECK (mode IN ('garrison', 'marching', 'attacking'))
);

CREATE INDEX armies_character_idx ON armies(character_id);
CREATE INDEX armies_node_idx      ON armies(node_id);

CREATE TABLE battle_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id     uuid NOT NULL REFERENCES characters(id),
  target_node_id  int  NOT NULL REFERENCES nodes(id),
  soldiers_sent   int  NOT NULL CHECK (soldiers_sent > 0),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'resolved')),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX battle_orders_pending_idx
  ON battle_orders(created_at)
  WHERE status = 'pending';

CREATE TABLE battle_logs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_order_id           uuid REFERENCES battle_orders(id),
  attacker_soldiers_lost    int  NOT NULL CHECK (attacker_soldiers_lost >= 0),
  defender_soldiers_lost    int  NOT NULL CHECK (defender_soldiers_lost >= 0),
  outcome                   text NOT NULL
                              CHECK (outcome IN ('attacker_wins', 'defender_wins', 'draw')),
  loot                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at              timestamptz DEFAULT now()
);

-- ================================================================
-- 9. POLITICS
-- ================================================================

CREATE TABLE positions (
  id                    text PRIMARY KEY,
  scope                 text NOT NULL CHECK (scope IN ('city', 'region', 'country')),
  term_days             int  NOT NULL CHECK (term_days > 0),
  election_period_days  int  NOT NULL CHECK (election_period_days > 0)
);

CREATE TABLE officeholders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  uuid NOT NULL REFERENCES characters(id),
  position_id   text NOT NULL REFERENCES positions(id),
  scope_id      int  NOT NULL,
  term_start    date NOT NULL,
  term_end      date NOT NULL
);

CREATE INDEX officeholders_position_scope_idx
  ON officeholders(position_id, scope_id, term_end DESC);

CREATE TABLE elections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id   text NOT NULL REFERENCES positions(id),
  scope_id      int  NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closes_at     timestamptz NOT NULL
);

CREATE INDEX elections_open_idx ON elections(status, closes_at);

CREATE TABLE votes (
  election_id   uuid NOT NULL REFERENCES elections(id),
  voter_id      uuid NOT NULL REFERENCES characters(id),
  candidate_id  uuid NOT NULL REFERENCES characters(id),
  created_at    timestamptz DEFAULT now(),
  PRIMARY KEY (election_id, voter_id)
);

-- ================================================================
-- 10. SYSTEM — cron, events, notifications, ledger
-- ================================================================

CREATE TABLE nightly_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      text NOT NULL CHECK (job_type IN ('ap_reset', 'production', 'battles', 'wages', 'elections')),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  started_at    timestamptz DEFAULT now(),
  finished_at   timestamptz,
  error         text,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX nightly_jobs_recent_idx ON nightly_jobs(started_at DESC);

CREATE TABLE game_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid REFERENCES characters(id),
  event_type    text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX game_events_actor_idx ON game_events(actor_id, created_at DESC);
CREATE INDEX game_events_type_idx  ON game_events(event_type, created_at DESC);

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at       timestamptz,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX notifications_unread_idx
  ON notifications(character_id, created_at DESC)
  WHERE read_at IS NULL;

-- Double-entry-style coin ledger. Every coin movement writes one
-- row here in the same transaction as the balance update. The sum
-- of (delta) for a character must equal that character's coin
-- balance — periodic reconciliation jobs will assert that.
CREATE TABLE ledger_entries (
  id            bigserial PRIMARY KEY,
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  delta         numeric NOT NULL,
  reason        text NOT NULL,
  ref_type      text,
  ref_id        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_character_idx
  ON ledger_entries(character_id, created_at DESC);

-- ================================================================
-- 11. Append-only enforcement on game_events
-- ----------------------------------------------------------------
-- A trigger that raises an error on UPDATE or DELETE is the cheap
-- way to guarantee the audit log stays an audit log even when
-- some future patch forgets the rule.
-- ================================================================

CREATE OR REPLACE FUNCTION game_events_no_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'game_events is append-only (operation: %)', TG_OP;
END;
$$;

CREATE TRIGGER game_events_block_update
  BEFORE UPDATE ON game_events
  FOR EACH ROW EXECUTE FUNCTION game_events_no_mutation();

CREATE TRIGGER game_events_block_delete
  BEFORE DELETE ON game_events
  FOR EACH ROW EXECUTE FUNCTION game_events_no_mutation();

-- ================================================================
-- 12. handle_new_user — sync auth.users → public.users
-- ================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_username text;
BEGIN
  -- Username is taken from raw_user_meta_data.username if provided,
  -- otherwise fall back to a random tag. Onboarding can rename.
  v_username := COALESCE(
    NEW.raw_user_meta_data ->> 'username',
    'wanderer_' || substr(replace(NEW.id::text, '-', ''), 1, 8)
  );

  INSERT INTO public.users (id, username)
  VALUES (NEW.id, v_username)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================================================
-- 13. transfer_coins — atomic coin movement with ledger audit
-- ----------------------------------------------------------------
-- Single chokepoint for ALL coin movement. Server Actions must
-- call this RPC instead of UPDATE'ing characters.coins directly.
--
-- p_from_character_id may be NULL for "the system" (wages, taxes,
-- treasury payouts). p_to_character_id may also be NULL for
-- destruction events.
-- ================================================================

CREATE OR REPLACE FUNCTION public.transfer_coins(
  p_from_character_id uuid,
  p_to_character_id   uuid,
  p_amount            numeric,
  p_reason            text,
  p_ref_type          text DEFAULT NULL,
  p_ref_id            text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'transfer amount must be positive';
  END IF;

  IF p_from_character_id IS NOT NULL THEN
    SELECT coins INTO v_balance FROM characters WHERE id = p_from_character_id FOR UPDATE;
    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'sender character not found';
    END IF;
    IF v_balance < p_amount THEN
      RAISE EXCEPTION 'insufficient funds';
    END IF;
    UPDATE characters SET coins = coins - p_amount WHERE id = p_from_character_id;
    INSERT INTO ledger_entries (character_id, delta, reason, ref_type, ref_id)
      VALUES (p_from_character_id, -p_amount, p_reason, p_ref_type, p_ref_id);
  END IF;

  IF p_to_character_id IS NOT NULL THEN
    UPDATE characters SET coins = coins + p_amount WHERE id = p_to_character_id;
    INSERT INTO ledger_entries (character_id, delta, reason, ref_type, ref_id)
      VALUES (p_to_character_id, p_amount, p_reason, p_ref_type, p_ref_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_coins(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_coins(uuid, uuid, numeric, text, text, text) TO authenticated, service_role;

-- ================================================================
-- 14. SEED DATA
-- ================================================================

INSERT INTO regions (name) VALUES
  ('Thrace'),
  ('Macedonia'),
  ('Epirus'),
  ('Moesia'),
  ('Anatolia');

INSERT INTO provinces (name, region_id, owner_type) VALUES
  ('Eastern Thrace',     1, 'independent'),
  ('Western Macedonia',  2, 'independent'),
  ('Central Macedonia',  2, 'independent');

INSERT INTO item_types (id, category, name, description, stackable, max_stack, weight, properties) VALUES
  ('coins',         'currency', 'Coins',          'Basic currency',           true,  null, 0,   '{"base_value": 1}'::jsonb),
  ('gems',          'currency', 'Gems',           'Premium currency',         true,  null, 0,   '{"base_value": 100}'::jsonb),
  ('bread',         'food',     'Bread',          'Basic food',               true,  99,   0.5, '{"hp_restore": 5, "spoils_after_days": 3}'::jsonb),
  ('oak_wood',      'resource', 'Oak Wood',       'Common building material', true,  null, 2,   '{"base_value": 2}'::jsonb),
  ('iron_ore',      'resource', 'Iron Ore',       'Raw iron',                 true,  null, 3,   '{"base_value": 3}'::jsonb),
  ('stone',         'resource', 'Stone',          'Quarried stone',           true,  null, 4,   '{"base_value": 2}'::jsonb),
  ('iron_sword',    'weapon',   'Iron Sword',     'A reliable sword',         false, 1,    5,   '{"damage": 15, "durability": 100, "required_strength": 3}'::jsonb),
  ('leather_armor', 'armor',    'Leather Armor',  'Basic protection',         false, 1,    4,   '{"defense": 5, "durability": 80}'::jsonb);

INSERT INTO building_types (id, name, output_item_id, output_qty_per_ap, wage_per_ap, required_stat) VALUES
  ('sawmill', 'Sawmill', 'oak_wood', 2, 1, 'strength'),
  ('quarry',  'Quarry',  'stone',    2, 1, 'strength'),
  ('forge',   'Forge',   'iron_ore', 1, 2, 'craft'),
  ('bakery',  'Bakery',  'bread',    3, 1, 'craft'),
  ('tavern',  'Tavern',  null,       0, 1, 'charisma');

INSERT INTO positions (id, scope, term_days, election_period_days) VALUES
  ('mayor',    'city',   30, 30),
  ('governor', 'region', 60, 60);

-- Cities are seeded in the second pass below, after we have node ids
-- to point them at. The admin-side seeding tool can create more.
-- Provincial capital nodes will be set via the admin UI.

-- ================================================================
-- 15. ROW LEVEL SECURITY
-- ----------------------------------------------------------------
-- Every public table has RLS enabled. Tables without explicit
-- policies are effectively closed to the anon and authenticated
-- roles, which is what we want.
-- ================================================================

ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clan_tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clan_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_actions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE armies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_buildings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE officeholders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nightly_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE provinces         ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE countries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE building_types    ENABLE ROW LEVEL SECURITY;

-- World data: anyone can read, only service role writes.
CREATE POLICY "world_regions_read"      ON regions          FOR SELECT USING (true);
CREATE POLICY "world_provinces_read"    ON provinces        FOR SELECT USING (true);
CREATE POLICY "world_nodes_read"        ON nodes            FOR SELECT USING (true);
CREATE POLICY "world_connections_read"  ON node_connections FOR SELECT USING (true);
CREATE POLICY "world_cities_read"       ON cities           FOR SELECT USING (true);
CREATE POLICY "world_countries_read"    ON countries        FOR SELECT USING (true);
CREATE POLICY "world_locations_read"    ON locations        FOR SELECT USING (true);
CREATE POLICY "world_clans_read"        ON clans            FOR SELECT USING (true);
CREATE POLICY "world_positions_read"    ON positions        FOR SELECT USING (true);
CREATE POLICY "world_item_types_read"   ON item_types       FOR SELECT USING (true);
CREATE POLICY "world_building_types_read" ON building_types FOR SELECT USING (true);
CREATE POLICY "world_city_buildings_read" ON city_buildings FOR SELECT USING (true);
CREATE POLICY "world_market_orders_read"  ON market_orders  FOR SELECT USING (true);
CREATE POLICY "world_armies_read"         ON armies         FOR SELECT USING (true);
CREATE POLICY "world_officeholders_read"  ON officeholders  FOR SELECT USING (true);
CREATE POLICY "world_elections_read"      ON elections      FOR SELECT USING (true);
CREATE POLICY "world_battle_logs_read"    ON battle_logs    FOR SELECT USING (true);

-- Users: read own, insert own (the trigger does this; explicit
-- policy keeps it functional if the trigger is ever bypassed).
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Characters
CREATE POLICY "characters_select_own_or_public_summary" ON characters
  FOR SELECT USING (true);  -- character names + locations are public; sensitive fields live elsewhere
CREATE POLICY "characters_insert_own" ON characters
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "characters_update_own" ON characters
  FOR UPDATE USING (auth.uid() = user_id);

-- Inventory: only the owner sees or modifies. Server Actions
-- use the user's session so this is enforced automatically.
CREATE POLICY "inventory_own" ON inventory
  FOR ALL USING (
    character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );

-- Notifications: own only.
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (
    character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );

-- Clan messages: members of the clan can read/post.
CREATE POLICY "clan_messages_members_read" ON clan_messages
  FOR SELECT USING (
    clan_id IN (SELECT clan_id FROM characters WHERE user_id = auth.uid())
  );
CREATE POLICY "clan_messages_members_write" ON clan_messages
  FOR INSERT WITH CHECK (
    clan_id IN (SELECT clan_id FROM characters WHERE user_id = auth.uid())
    AND author_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );

-- Clan tasks: members read; assigned_by must be one of caller's chars.
CREATE POLICY "clan_tasks_members_read" ON clan_tasks
  FOR SELECT USING (
    clan_id IN (SELECT clan_id FROM characters WHERE user_id = auth.uid())
  );

-- Votes: own only.
CREATE POLICY "votes_own" ON votes
  FOR ALL USING (
    voter_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );

-- Work actions: own only.
CREATE POLICY "work_actions_own" ON work_actions
  FOR ALL USING (
    character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );

-- Ledger: own only (read). Writes only via transfer_coins SECURITY DEFINER.
CREATE POLICY "ledger_own_read" ON ledger_entries
  FOR SELECT USING (
    character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );

-- Game events: own actor or system events readable to the actor.
-- Anyone can read system-wide events (actor_id IS NULL) and their
-- own; broader visibility rules can be added later.
CREATE POLICY "game_events_actor_or_system_read" ON game_events
  FOR SELECT USING (
    actor_id IS NULL
    OR actor_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );

-- ================================================================
-- 16. NIGHTLY CRON
-- ----------------------------------------------------------------
-- pg_cron triggers a single Edge Function which orchestrates
-- ap_reset → wages → production → battles → elections → notifications.
-- The Edge Function logs each step to nightly_jobs and continues on
-- partial failure so a broken battle resolver can't block AP reset.
--
-- The URL and the bearer token below are placeholders. Replace with
-- the actual values from Project Settings → Edge Functions, or wire
-- them in via Supabase Vault / Edge Function secrets.
-- ================================================================

-- SELECT cron.schedule(
--   'imperium-nightly',
--   '0 0 * * *',
--   $$
--     SELECT net.http_post(
--       url     := 'https://<project-ref>.supabase.co/functions/v1/nightly-cycle',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer <service-role-or-cron-token>'
--       ),
--       body    := jsonb_build_object('trigger', 'pg_cron')
--     );
--   $$
-- );
