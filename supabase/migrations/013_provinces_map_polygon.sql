-- Imperium — Migration 013: province polygons (legacy parchment coordinates)
--
-- map_polygon: JSON array of [map_x, map_y] vertices forming one closed ring
-- (first point may repeat last for clarity; renderer closes the path).

ALTER TABLE public.provinces
  ADD COLUMN IF NOT EXISTS map_polygon jsonb;

COMMENT ON COLUMN public.provinces.map_polygon IS
  'Closed polygon in legacy map space: [[x,y],[x,y],...] same units as nodes.map_x/y';

-- Eastern Thrace — Marmara coast, Adrianople–Constantinople corridor
UPDATE public.provinces
SET map_polygon = '[
  [535, 358],
  [618, 362],
  [698, 392],
  [708, 438],
  [665, 468],
  [575, 458],
  [528, 412],
  [535, 358]
]'::jsonb
WHERE name = 'Eastern Thrace';

-- Central Macedonia — around Thessaloniki
UPDATE public.provinces
SET map_polygon = '[
  [425, 408],
  [498, 402],
  [512, 472],
  [442, 482],
  [408, 448],
  [425, 408]
]'::jsonb
WHERE name = 'Central Macedonia';

-- Western Macedonia — west of the Thermaic gulf cluster
UPDATE public.provinces
SET map_polygon = '[
  [305, 418],
  [392, 408],
  [405, 478],
  [322, 488],
  [288, 452],
  [305, 418]
]'::jsonb
WHERE name = 'Western Macedonia';

-- Moesia — Danube littoral / Dobruja wedge toward the sea
UPDATE public.provinces
SET map_polygon = '[
  [455, 275],
  [578, 282],
  [585, 338],
  [515, 348],
  [468, 318],
  [455, 275]
]'::jsonb
WHERE name = 'Moesia';
