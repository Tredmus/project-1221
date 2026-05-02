-- ================================================================
-- Imperium — Migration 007: seed Constantinople, Adrianople, Thessaloniki
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
-- 1. Nodes — idempotent on (name, type); FK uses live province ids
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
-- 3. Polymorphic pointer: node.entity_id → cities.id
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
