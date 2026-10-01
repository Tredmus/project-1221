/** Mirrors the database enums (supabase/migrations/*_world_map.sql). */
export const MAIN_NODE_TYPES = ['town', 'castle', 'mine', 'farm', 'monastery'] as const;
export const TRAVEL_NODE_TYPES = ['road', 'crossroads', 'ford', 'pass', 'forest'] as const;
export const NODE_TYPES = [...MAIN_NODE_TYPES, ...TRAVEL_NODE_TYPES] as const;
export const BIOMES = ['plains', 'forest', 'hills', 'mountains', 'steppe', 'marsh', 'coast', 'desert'] as const;

export type MainNodeType = (typeof MAIN_NODE_TYPES)[number];
export type NodeType = (typeof NODE_TYPES)[number];
export type Biome = (typeof BIOMES)[number];

/** Only the node that controls a county has a main type (GDD 3.1). */
export function isMainNodeType(type: NodeType): type is MainNodeType {
  return (MAIN_NODE_TYPES as readonly string[]).includes(type);
}

export interface BorderPoint {
  id: number;
  lon: number;
  lat: number;
}

/** A straight border segment. Walking from point_a to point_b, left_county_id is on the left. */
export interface BorderEdge {
  id: number;
  point_a: number;
  point_b: number;
  left_county_id: number | null;
  right_county_id: number | null;
}

/** The parts of the tier rows the border math needs. */
export interface TierLinks {
  counties: Iterable<{ id: number; duchy_id: number | null }>;
  duchies: Iterable<{ id: number; kingdom_id: number | null }>;
  kingdoms: Iterable<{ id: number; empire_id: number | null }>;
}

/** A county piece: one outer ring and its holes, as point ids (first point not repeated). */
export interface CountyPolygon {
  outer: number[];
  holes: number[][];
}
