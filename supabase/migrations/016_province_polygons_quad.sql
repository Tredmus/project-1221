-- Imperium — Migration 016: reduce each province polygon to a simple quadrilateral
--
-- Replaces map_polygon with the axis-aligned bounding rectangle (in legacy x/y)
-- of the previous vertices: SW → SE → NE → NW corner order (4 vertices).
-- Provinces without a polygon or with invalid JSON are left unchanged.

UPDATE public.provinces AS p
SET map_polygon = q.quad
FROM (
  SELECT
    b.id,
    jsonb_build_array(
      jsonb_build_array(b.min_x, b.min_y),
      jsonb_build_array(b.max_x, b.min_y),
      jsonb_build_array(b.max_x, b.max_y),
      jsonb_build_array(b.min_x, b.max_y)
    ) AS quad
  FROM (
    SELECT
      p2.id,
      min((elem ->> 0)::numeric) AS min_x,
      max((elem ->> 0)::numeric) AS max_x,
      min((elem ->> 1)::numeric) AS min_y,
      max((elem ->> 1)::numeric) AS max_y
    FROM public.provinces p2,
    LATERAL jsonb_array_elements(p2.map_polygon) AS elem
    WHERE p2.map_polygon IS NOT NULL
      AND jsonb_typeof(p2.map_polygon) = 'array'
      AND jsonb_array_length(p2.map_polygon) >= 3
    GROUP BY p2.id
  ) AS b
) AS q
WHERE p.id = q.id;
