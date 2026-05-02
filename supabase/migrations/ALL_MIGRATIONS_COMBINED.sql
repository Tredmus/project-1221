-- ================================================================
-- Imperium â€” Initial migration
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
--      Edge Function â€” the Edge Function orchestrates each step
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
-- 1. WORLD â€” regions, provinces, nodes, connections
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
-- 7. ECONOMY â€” buildings, work, market
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
-- 10. SYSTEM â€” cron, events, notifications, ledger
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
-- balance â€” periodic reconciliation jobs will assert that.
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
-- 12. handle_new_user â€” sync auth.users â†’ public.users
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
-- 13. transfer_coins â€” atomic coin movement with ledger audit
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
-- ap_reset â†’ wages â†’ production â†’ battles â†’ elections â†’ notifications.
-- The Edge Function logs each step to nightly_jobs and continues on
-- partial failure so a broken battle resolver can't block AP reset.
--
-- The URL and the bearer token below are placeholders. Replace with
-- the actual values from Project Settings â†’ Edge Functions, or wire
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

-- ================================================================
-- Imperium â€” Migration 002: travel & atomic AP spending
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
-- the deduction â€” the classic TOCTOU hole is eliminated.
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

-- ================================================================
-- Imperium â€” Migration 003: economy functions & building seed
-- ================================================================
-- Run AFTER 002_travel.sql.
--
-- Functions created here:
--   1. add_to_inventory          â€” helper: UPSERT-increment inventory
--   2. queue_work_action         â€” atomic AP spend + work queue insert
--   3. process_single_work_action â€” nightly cron: deliver output + wages
--   4. create_market_listing     â€” atomic escrow + order create
--   5. fill_market_order         â€” atomic buy (coins + items)
--   6. cancel_market_order       â€” return escrowed items to seller
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

  -- Pay wage: system â†’ character (no sender, coins minted from thin air for MVP).
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
--    Coins flow buyer â†’ seller; items flow listing â†’ buyer inventory.
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

  -- Transfer coins buyer â†’ seller (transfer_coins checks buyer balance).
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

-- ================================================================
-- Imperium â€” Migration 004: nightly helpers & cron
-- ================================================================
-- Run AFTER 003_economy.sql.
--
-- 1. reset_all_ap()       â€” bulk AP restore (called by Edge Function)
-- 2. pg_cron schedule     â€” triggers the nightly Edge Function at 00:00 UTC
--
-- For the cron: fill in your project ref and NIGHTLY_SECRET before
-- uncommenting the cron.schedule block at the bottom.
-- ================================================================

-- ----------------------------------------------------------------
-- reset_all_ap
-- Called once per nightly cycle by the Edge Function (service_role).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_all_ap()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE characters
  SET    action_points = max_action_points;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('count', v_count);
END;
$$;

REVOKE ALL  ON FUNCTION public.reset_all_ap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_all_ap() TO service_role;

-- ================================================================
-- NIGHTLY CRON
-- ----------------------------------------------------------------
-- Uncomment and fill in the values below once:
--   1. The nightly-cycle Edge Function is deployed.
--   2. You have set NIGHTLY_SECRET in the Edge Function secrets
--      (Dashboard â†’ Edge Functions â†’ nightly-cycle â†’ Secrets).
--   3. You know your project ref (the subdomain of supabase.co).
--
-- Run this block in the SQL editor to activate the cron. You can
-- also update just the URL/secret without dropping and recreating.
-- ================================================================

-- SELECT cron.unschedule('imperium-nightly') WHERE EXISTS (
--   SELECT 1 FROM cron.job WHERE jobname = 'imperium-nightly'
-- );
--
-- SELECT cron.schedule(
--   'imperium-nightly',
--   '0 0 * * *',
--   $$
--     SELECT net.http_post(
--       url     := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/nightly-cycle',
--       headers := jsonb_build_object(
--         'Content-Type',      'application/json',
--         'x-nightly-secret',  '<YOUR-NIGHTLY-SECRET>'
--       ),
--       body    := jsonb_build_object('trigger', 'pg_cron', 'ts', now()::text)
--     );
--   $$
-- );

-- ================================================================
-- Imperium â€” Migration 005: clan invitations & RPCs
-- ================================================================
-- Run AFTER 004_nightly_setup.sql.
--
-- New table:
--   clan_invitations  â€” pending / accepted / declined invites
--
-- New functions:
--   create_clan              â€” found a new clan (leader only, checks name/tag uniqueness)
--   invite_to_clan           â€” leader/officer sends invite by character name
--   accept_clan_invite       â€” invited character joins
--   decline_clan_invite      â€” invited character declines
--   leave_clan               â€” member or leader leaves; disbands if last member
--   deposit_to_clan_treasury â€” character moves coins to clan pool
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

-- ================================================================
-- Imperium â€” Migration 006: politics & military RPCs
-- ================================================================
-- Run AFTER 005_clans.sql.
--
-- New functions:
--   open_election       â€” any char in scope can start an election
--   cast_vote           â€” vote in an open election
--   close_election      â€” tally votes, install officeholder, notify
--   process_elections   â€” called by nightly cron (closes expired)
--   recruit_soldiers    â€” spend coins â†’ create/grow army
--   march_army          â€” move army to an adjacent node (no AP cost)
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
--    (city_id / province_id checks omitted for MVP â€” trusting RLS).
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
--    Tally votes â†’ winner gets an officeholder row.
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

-- ================================================================
-- Imperium â€” Migration 007: seed Constantinople, Adrianople, Thessaloniki
-- ================================================================
-- Safe to run more than once (skips rows that already exist).
--
-- If `cities` stayed empty after running an older version of this file,
-- the usual cause was missing `provinces` rows (FK on nodes.province_id).
-- Inserts then failed silently for nodes; city INSERTs matched 0 nodes.
-- This revision bootstraps regions/provinces like 001 when absent, and
-- resolves province ids by name instead of hard-coded serials.

-- ----------------------------------------------------------------
-- 0. Minimal world shell (only when tables are empty / rows missing)
-- ----------------------------------------------------------------
INSERT INTO regions (name)
SELECT 'Thrace'
WHERE NOT EXISTS (SELECT 1 FROM regions WHERE name = 'Thrace');

INSERT INTO regions (name)
SELECT 'Macedonia'
WHERE NOT EXISTS (SELECT 1 FROM regions WHERE name = 'Macedonia');

INSERT INTO provinces (name, region_id, owner_type)
SELECT 'Eastern Thrace', r.id, 'independent'
FROM regions r
WHERE r.name = 'Thrace'
  AND NOT EXISTS (SELECT 1 FROM provinces WHERE name = 'Eastern Thrace')
LIMIT 1;

INSERT INTO provinces (name, region_id, owner_type)
SELECT 'Central Macedonia', r.id, 'independent'
FROM regions r
WHERE r.name = 'Macedonia'
  AND NOT EXISTS (SELECT 1 FROM provinces WHERE name = 'Central Macedonia')
LIMIT 1;

-- ----------------------------------------------------------------
-- 1. Nodes â€” idempotent on (name, type); FK uses live province ids
-- ----------------------------------------------------------------
INSERT INTO nodes (name, type, entity_id, province_id, is_capital, map_x, map_y)
SELECT 'Constantinople', 'city', NULL, p.id, true, 660, 420
FROM provinces p
WHERE p.name = 'Eastern Thrace'
  AND NOT EXISTS (
    SELECT 1 FROM nodes n WHERE n.name = 'Constantinople' AND n.type = 'city'
  )
LIMIT 1;

INSERT INTO nodes (name, type, entity_id, province_id, is_capital, map_x, map_y)
SELECT 'Adrianople', 'city', NULL, p.id, false, 580, 380
FROM provinces p
WHERE p.name = 'Eastern Thrace'
  AND NOT EXISTS (
    SELECT 1 FROM nodes n WHERE n.name = 'Adrianople' AND n.type = 'city'
  )
LIMIT 1;

INSERT INTO nodes (name, type, entity_id, province_id, is_capital, map_x, map_y)
SELECT 'Thessaloniki', 'city', NULL, p.id, false, 460, 440
FROM provinces p
WHERE p.name = 'Central Macedonia'
  AND NOT EXISTS (
    SELECT 1 FROM nodes n WHERE n.name = 'Thessaloniki' AND n.type = 'city'
  )
LIMIT 1;

-- ----------------------------------------------------------------
-- 2. Cities (one row per name; pick earliest node id if duplicates exist)
-- ----------------------------------------------------------------
INSERT INTO cities (node_id, name, wall_level, is_capital, properties)
SELECT n.id, 'Constantinople', 5, true,
  '{"description":"The Queen of Cities","port":true,"market_level":3}'::jsonb
FROM nodes n
WHERE n.name = 'Constantinople' AND n.type = 'city'
  AND NOT EXISTS (SELECT 1 FROM cities c WHERE c.name = 'Constantinople')
ORDER BY n.id
LIMIT 1;

INSERT INTO cities (node_id, name, wall_level, is_capital, properties)
SELECT n.id, 'Adrianople', 3, false,
  '{"description":"Gateway to Thrace","port":false,"market_level":2}'::jsonb
FROM nodes n
WHERE n.name = 'Adrianople' AND n.type = 'city'
  AND NOT EXISTS (SELECT 1 FROM cities c WHERE c.name = 'Adrianople')
ORDER BY n.id
LIMIT 1;

INSERT INTO cities (node_id, name, wall_level, is_capital, properties)
SELECT n.id, 'Thessaloniki', 3, false,
  '{"description":"Second city of the Empire","port":true,"market_level":2}'::jsonb
FROM nodes n
WHERE n.name = 'Thessaloniki' AND n.type = 'city'
  AND NOT EXISTS (SELECT 1 FROM cities c WHERE c.name = 'Thessaloniki')
ORDER BY n.id
LIMIT 1;

-- ----------------------------------------------------------------
-- 3. Polymorphic pointer: node.entity_id â†’ cities.id
-- ----------------------------------------------------------------
UPDATE nodes n
SET entity_id = c.id
FROM cities c
WHERE c.node_id = n.id
  AND c.name IN ('Constantinople', 'Adrianople', 'Thessaloniki')
  AND (n.entity_id IS DISTINCT FROM c.id);

-- ----------------------------------------------------------------
-- 4. Roads (single undirected row per edge; smaller id is node_a)
-- ----------------------------------------------------------------
INSERT INTO node_connections (node_a_id, node_b_id, travel_cost, road_type, min_tier_required)
SELECT
  LEAST(c.node_id, d.node_id),
  GREATEST(c.node_id, d.node_id),
  3,
  'road',
  1
FROM cities c
JOIN cities d ON d.name = 'Adrianople'
WHERE c.name = 'Constantinople'
  AND NOT EXISTS (
    SELECT 1
    FROM node_connections nc
    WHERE nc.node_a_id = LEAST(c.node_id, d.node_id)
      AND nc.node_b_id = GREATEST(c.node_id, d.node_id)
  );

INSERT INTO node_connections (node_a_id, node_b_id, travel_cost, road_type, min_tier_required)
SELECT
  LEAST(c.node_id, d.node_id),
  GREATEST(c.node_id, d.node_id),
  5,
  'road',
  1
FROM cities c
JOIN cities d ON d.name = 'Thessaloniki'
WHERE c.name = 'Adrianople'
  AND NOT EXISTS (
    SELECT 1
    FROM node_connections nc
    WHERE nc.node_a_id = LEAST(c.node_id, d.node_id)
      AND nc.node_b_id = GREATEST(c.node_id, d.node_id)
  );

-- ----------------------------------------------------------------
-- 5. City buildings (same sets as 003_economy.sql)
-- ----------------------------------------------------------------
INSERT INTO city_buildings (city_id, building_type_id, owner_id, level)
SELECT c.id, bt.id, NULL, 1
FROM cities c
CROSS JOIN (VALUES
  ('sawmill'), ('forge'), ('bakery'), ('tavern')
) AS bt(id)
WHERE c.name = 'Constantinople'
  AND NOT EXISTS (
    SELECT 1 FROM city_buildings cb
    WHERE cb.city_id = c.id AND cb.building_type_id = bt.id
  );

INSERT INTO city_buildings (city_id, building_type_id, owner_id, level)
SELECT c.id, bt.id, NULL, 1
FROM cities c
CROSS JOIN (VALUES
  ('sawmill'), ('bakery'), ('quarry')
) AS bt(id)
WHERE c.name = 'Adrianople'
  AND NOT EXISTS (
    SELECT 1 FROM city_buildings cb
    WHERE cb.city_id = c.id AND cb.building_type_id = bt.id
  );

INSERT INTO city_buildings (city_id, building_type_id, owner_id, level)
SELECT c.id, bt.id, NULL, 1
FROM cities c
CROSS JOIN (VALUES
  ('sawmill'), ('forge'), ('bakery'), ('tavern')
) AS bt(id)
WHERE c.name = 'Thessaloniki'
  AND NOT EXISTS (
    SELECT 1 FROM city_buildings cb
    WHERE cb.city_id = c.id AND cb.building_type_id = bt.id
  );

-- ================================================================
-- Imperium â€” Migration 008: GRANT + RLS for API reads (onboarding, map)
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

-- ================================================================
-- Imperium â€” Migration 009: RPC for onboarding city list
-- ================================================================
-- Direct SELECT from the app can still return 0 rows when GRANT/RLS and
-- the PostgREST stack disagree with what you see in the Table Editor.
-- This function runs as SECURITY DEFINER (owner bypasses RLS for the inner
-- SELECT) and only exposes id, name, properties â€” same as public world data.

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

