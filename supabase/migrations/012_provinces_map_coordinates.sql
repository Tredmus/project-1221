-- Imperium — Migration 012: province map anchors (legacy parchment coordinates)
--
-- Same coordinate space as nodes.map_x / map_y. Used to fit the projection,
-- draw province hulls (with nodes), and place province labels. Values are
-- hand-placed centroids: Thrace / Macedonian cluster, Moesia toward the Danube.

ALTER TABLE public.provinces
  ADD COLUMN IF NOT EXISTS map_x numeric,
  ADD COLUMN IF NOT EXISTS map_y numeric;

COMMENT ON COLUMN public.provinces.map_x IS 'Parchment map X (same space as nodes.map_x)';
COMMENT ON COLUMN public.provinces.map_y IS 'Parchment map Y (same space as nodes.map_y)';

-- Eastern Thrace: between Adrianople and Constantinople
UPDATE public.provinces
SET map_x = 620, map_y = 400
WHERE name = 'Eastern Thrace';

-- Central Macedonia: at Thessaloniki
UPDATE public.provinces
SET map_x = 460, map_y = 440
WHERE name = 'Central Macedonia';

-- Western Macedonia: west of Thessaloniki
UPDATE public.provinces
SET map_x = 375, map_y = 455
WHERE name = 'Western Macedonia';

-- Moesia: Danube–Black Sea belt (north of Thrace in this projection)
UPDATE public.provinces
SET map_x = 540, map_y = 305
WHERE name = 'Moesia';
