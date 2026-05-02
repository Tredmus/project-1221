-- Imperium — Migration 011: region Lower Danube + province Moesia
--
-- Moesia (classical Lower Moesia / land along the Haemus): the Danube to the
-- north, the Balkan mountains to the south and west, the Black Sea to the east.

INSERT INTO regions (name)
SELECT 'Lower Danube'
WHERE NOT EXISTS (SELECT 1 FROM regions WHERE name = 'Lower Danube');

INSERT INTO provinces (name, region_id, owner_type)
SELECT 'Moesia', r.id, 'independent'
FROM regions r
WHERE r.name = 'Lower Danube'
  AND NOT EXISTS (SELECT 1 FROM provinces WHERE name = 'Moesia')
LIMIT 1;
