/**
 * Hand-written game types.
 *
 * Anything that's not a 1:1 reflection of a Postgres table goes here:
 *   - Domain enums we maintain in code (e.g. UI-only labels)
 *   - Shapes returned by composed queries (character + node + clan, etc.)
 *   - DTOs passed between Server Actions and components
 */

import type { Json } from "./database.types";

/**
 * Hand-written row shapes that mirror the Postgres tables. Replace these
 * with `Database["public"]["Tables"]["*"]["Row"]` lookups once the
 * generated types are in place (run `npm run db:types`).
 */
export interface DbCharacter {
  id: string;
  user_id: string;
  name: string;
  node_id: number | null;
  home_city_id: number | null;
  coins: number;
  gems: number;
  level: number;
  experience: number;
  profession: string;
  action_points: number;
  max_action_points: number;
  travel_tier: number;
  strength: number;
  craft: number;
  charisma: number;
  intelligence: number;
  clan_id: string | null;
  clan_role: string | null;
  titles: string[];
  created_at: string;
}

export interface DbNode {
  id: number;
  name: string | null;
  type: NodeType;
  entity_id: number | null;
  province_id: number | null;
  is_capital: boolean;
  map_x: number;
  map_y: number;
  created_at: string;
}

export interface DbCity {
  id: number;
  node_id: number | null;
  name: string;
  wall_level: number;
  is_capital: boolean;
  properties: Json;
}

export interface DbInventoryRow {
  id: number;
  character_id: string;
  item_type_id: string;
  quantity: number;
  condition: number | null;
}

export interface DbItemType {
  id: string;
  category: "resource" | "weapon" | "food" | "armor" | "tool" | "currency";
  name: string;
  description: string | null;
  stackable: boolean;
  max_stack: number | null;
  weight: number;
  properties: Json;
}

export type Profession =
  | "peasant"
  | "soldier"
  | "merchant"
  | "blacksmith"
  | "farmer"
  | "miner"
  | "politician"
  | "priest";

export const PROFESSIONS: ReadonlyArray<{
  id: Profession;
  label: string;
  blurb: string;
}> = [
  {
    id: "peasant",
    label: "Peasant",
    blurb:
      "A humble start. Work the fields, save your coins, and dream of better days.",
  },
  {
    id: "soldier",
    label: "Soldier",
    blurb: "Strong arm, dull mind. The empire's first and last line of defence.",
  },
  {
    id: "merchant",
    label: "Merchant",
    blurb: "Buy low, sell high. The economy bends to those who understand it.",
  },
  {
    id: "blacksmith",
    label: "Blacksmith",
    blurb: "Master of the forge. Wars are won by the hands that arm them.",
  },
  {
    id: "farmer",
    label: "Farmer",
    blurb: "Feed the city. Without you, the empire starves.",
  },
];

export const NODE_TYPES = [
  "road",
  "city",
  "settlement",
  "farm",
  "mine",
  "port",
  "fortress",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Composed shape used by `getCurrentCharacter()` and rendered in the game
 * shell on every page.
 */
export interface CurrentCharacter {
  id: string;
  user_id: string;
  name: string;
  profession: Profession;
  level: number;
  experience: number;
  coins: number;
  gems: number;
  action_points: number;
  max_action_points: number;
  travel_tier: number;
  strength: number;
  craft: number;
  charisma: number;
  intelligence: number;
  titles: string[];
  clan_id: string | null;
  clan_role: "leader" | "officer" | "member" | null;
  home_city_id: number | null;
  node_id: number | null;
  /** Joined city row for the character's home_city_id, if set. */
  home_city: Pick<DbCity, "id" | "name"> | null;
  /** Joined node row for where the character currently is, if set. */
  current_node: Pick<DbNode, "id" | "name" | "type" | "map_x" | "map_y" | "province_id"> | null;
}

export interface InventoryItem {
  item_type_id: string;
  quantity: number;
  condition: number | null;
  /** Denormalized from item_types for display. */
  name: string;
  category: DbItemType["category"];
  description: string | null;
  weight: number;
}

export interface MapNodeView {
  id: number;
  name: string | null;
  type: NodeType;
  map_x: number;
  map_y: number;
  province_id: number | null;
  is_capital: boolean;
}

export interface MapConnectionView {
  node_a_id: number;
  node_b_id: number;
  road_type: "road" | "river" | "sea";
  travel_cost: number;
  min_tier_required: number;
}
