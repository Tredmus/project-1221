export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      border_edges: {
        Row: {
          id: number
          left_county_id: number | null
          point_a: number
          point_b: number
          right_county_id: number | null
        }
        Insert: {
          id?: never
          left_county_id?: number | null
          point_a: number
          point_b: number
          right_county_id?: number | null
        }
        Update: {
          id?: never
          left_county_id?: number | null
          point_a?: number
          point_b?: number
          right_county_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "border_edges_left_county_id_fkey"
            columns: ["left_county_id"]
            isOneToOne: false
            referencedRelation: "counties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "border_edges_point_a_fkey"
            columns: ["point_a"]
            isOneToOne: false
            referencedRelation: "border_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "border_edges_point_b_fkey"
            columns: ["point_b"]
            isOneToOne: false
            referencedRelation: "border_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "border_edges_right_county_id_fkey"
            columns: ["right_county_id"]
            isOneToOne: false
            referencedRelation: "counties"
            referencedColumns: ["id"]
          },
        ]
      }
      border_points: {
        Row: {
          id: number
          lat: number
          lon: number
        }
        Insert: {
          id?: never
          lat: number
          lon: number
        }
        Update: {
          id?: never
          lat?: number
          lon?: number
        }
        Relationships: []
      }
      characters: {
        Row: {
          account_id: string
          agility: number
          attribute_points: number
          country_id: number
          created_at: string
          culture_id: string
          dexterity: number
          experience: number
          heraldry: Json | null
          id: string
          level: number
          name: string
          portrait: string | null
          religion_id: string
          strength: number
          vitality: number
          wits: number
        }
        Insert: {
          account_id: string
          agility: number
          attribute_points?: number
          country_id: number
          created_at?: string
          culture_id: string
          dexterity: number
          experience?: number
          heraldry?: Json | null
          id?: string
          level?: number
          name: string
          portrait?: string | null
          religion_id: string
          strength: number
          vitality: number
          wits: number
        }
        Update: {
          account_id?: string
          agility?: number
          attribute_points?: number
          country_id?: number
          created_at?: string
          culture_id?: string
          dexterity?: number
          experience?: number
          heraldry?: Json | null
          id?: string
          level?: number
          name?: string
          portrait?: string | null
          religion_id?: string
          strength?: number
          vitality?: number
          wits?: number
        }
        Relationships: [
          {
            foreignKeyName: "characters_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_culture_id_fkey"
            columns: ["culture_id"]
            isOneToOne: false
            referencedRelation: "cultures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_religion_id_fkey"
            columns: ["religion_id"]
            isOneToOne: false
            referencedRelation: "religions"
            referencedColumns: ["id"]
          },
        ]
      }
      clan_invites: {
        Row: {
          character_id: string
          clan_id: string
          created_at: string
          invited_by: string | null
        }
        Insert: {
          character_id: string
          clan_id: string
          created_at?: string
          invited_by?: string | null
        }
        Update: {
          character_id?: string
          clan_id?: string
          created_at?: string
          invited_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clan_invites_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clan_invites_clan_id_fkey"
            columns: ["clan_id"]
            isOneToOne: false
            referencedRelation: "clans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clan_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      clan_members: {
        Row: {
          character_id: string
          clan_id: string
          joined_at: string
        }
        Insert: {
          character_id: string
          clan_id: string
          joined_at?: string
        }
        Update: {
          character_id?: string
          clan_id?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clan_members_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clan_members_clan_id_fkey"
            columns: ["clan_id"]
            isOneToOne: false
            referencedRelation: "clans"
            referencedColumns: ["id"]
          },
        ]
      }
      clans: {
        Row: {
          created_at: string
          id: string
          leader_character_id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          leader_character_id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          leader_character_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "clans_leader_character_id_fkey"
            columns: ["leader_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      counties: {
        Row: {
          created_at: string
          culture_id: string | null
          duchy_id: number | null
          id: number
          main_node_id: number | null
          name: string
          religion_id: string | null
        }
        Insert: {
          created_at?: string
          culture_id?: string | null
          duchy_id?: number | null
          id?: never
          main_node_id?: number | null
          name: string
          religion_id?: string | null
        }
        Update: {
          created_at?: string
          culture_id?: string | null
          duchy_id?: number | null
          id?: never
          main_node_id?: number | null
          name?: string
          religion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counties_culture_id_fkey"
            columns: ["culture_id"]
            isOneToOne: false
            referencedRelation: "cultures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counties_duchy_id_fkey"
            columns: ["duchy_id"]
            isOneToOne: false
            referencedRelation: "duchies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counties_main_node_id_fkey"
            columns: ["main_node_id"]
            isOneToOne: true
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counties_religion_id_fkey"
            columns: ["religion_id"]
            isOneToOne: false
            referencedRelation: "religions"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          created_at: string
          culture_id: string
          home_county_id: number | null
          id: number
          name: string
          religion_id: string
        }
        Insert: {
          created_at?: string
          culture_id: string
          home_county_id?: number | null
          id?: never
          name: string
          religion_id: string
        }
        Update: {
          created_at?: string
          culture_id?: string
          home_county_id?: number | null
          id?: never
          name?: string
          religion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "countries_culture_id_fkey"
            columns: ["culture_id"]
            isOneToOne: false
            referencedRelation: "cultures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "countries_home_county_id_fkey"
            columns: ["home_county_id"]
            isOneToOne: false
            referencedRelation: "counties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "countries_religion_id_fkey"
            columns: ["religion_id"]
            isOneToOne: false
            referencedRelation: "religions"
            referencedColumns: ["id"]
          },
        ]
      }
      cultures: {
        Row: {
          id: string
          name: string
          sort: number
        }
        Insert: {
          id: string
          name: string
          sort?: number
        }
        Update: {
          id?: string
          name?: string
          sort?: number
        }
        Relationships: []
      }
      duchies: {
        Row: {
          created_at: string
          id: number
          kingdom_id: number | null
          main_county_id: number | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: never
          kingdom_id?: number | null
          main_county_id?: number | null
          name: string
        }
        Update: {
          created_at?: string
          id?: never
          kingdom_id?: number | null
          main_county_id?: number | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "duchies_kingdom_id_fkey"
            columns: ["kingdom_id"]
            isOneToOne: false
            referencedRelation: "kingdoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duchies_main_county_id_fkey"
            columns: ["main_county_id"]
            isOneToOne: false
            referencedRelation: "counties"
            referencedColumns: ["id"]
          },
        ]
      }
      election_candidates: {
        Row: {
          character_id: string
          created_at: string
          election_id: number
        }
        Insert: {
          character_id: string
          created_at?: string
          election_id: number
        }
        Update: {
          character_id?: string
          created_at?: string
          election_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "election_candidates_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "election_candidates_election_id_fkey"
            columns: ["election_id"]
            isOneToOne: false
            referencedRelation: "elections"
            referencedColumns: ["id"]
          },
        ]
      }
      election_votes: {
        Row: {
          candidate_character_id: string
          created_at: string
          election_id: number
          voter_character_id: string
        }
        Insert: {
          candidate_character_id: string
          created_at?: string
          election_id: number
          voter_character_id: string
        }
        Update: {
          candidate_character_id?: string
          created_at?: string
          election_id?: number
          voter_character_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "election_votes_election_id_candidate_character_id_fkey"
            columns: ["candidate_character_id", "election_id"]
            isOneToOne: false
            referencedRelation: "election_candidates"
            referencedColumns: ["character_id", "election_id"]
          },
          {
            foreignKeyName: "election_votes_voter_character_id_fkey"
            columns: ["voter_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      elections: {
        Row: {
          closes_at: string
          created_at: string
          id: number
          office_id: number
          opens_at: string
          status: Database["public"]["Enums"]["election_status"]
          winner_character_id: string | null
        }
        Insert: {
          closes_at: string
          created_at?: string
          id?: never
          office_id: number
          opens_at: string
          status?: Database["public"]["Enums"]["election_status"]
          winner_character_id?: string | null
        }
        Update: {
          closes_at?: string
          created_at?: string
          id?: never
          office_id?: number
          opens_at?: string
          status?: Database["public"]["Enums"]["election_status"]
          winner_character_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "elections_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elections_winner_character_id_fkey"
            columns: ["winner_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      empires: {
        Row: {
          created_at: string
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
        }
        Relationships: []
      }
      kingdoms: {
        Row: {
          created_at: string
          empire_id: number | null
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          empire_id?: number | null
          id?: never
          name: string
        }
        Update: {
          created_at?: string
          empire_id?: number | null
          id?: never
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "kingdoms_empire_id_fkey"
            columns: ["empire_id"]
            isOneToOne: false
            referencedRelation: "empires"
            referencedColumns: ["id"]
          },
        ]
      }
      map_references: {
        Row: {
          created_at: string
          east: number | null
          id: number
          kind: string
          name: string
          north: number | null
          opacity: number
          sort: number
          south: number | null
          storage_path: string | null
          tile_url: string | null
          visible: boolean
          west: number | null
        }
        Insert: {
          created_at?: string
          east?: number | null
          id?: never
          kind: string
          name: string
          north?: number | null
          opacity?: number
          sort?: number
          south?: number | null
          storage_path?: string | null
          tile_url?: string | null
          visible?: boolean
          west?: number | null
        }
        Update: {
          created_at?: string
          east?: number | null
          id?: never
          kind?: string
          name?: string
          north?: number | null
          opacity?: number
          sort?: number
          south?: number | null
          storage_path?: string | null
          tile_url?: string | null
          visible?: boolean
          west?: number | null
        }
        Relationships: []
      }
      nodes: {
        Row: {
          biome: Database["public"]["Enums"]["biome"]
          county_id: number | null
          created_at: string
          id: number
          lat: number
          lon: number
          name: string | null
          type: Database["public"]["Enums"]["node_type"]
        }
        Insert: {
          biome: Database["public"]["Enums"]["biome"]
          county_id?: number | null
          created_at?: string
          id?: never
          lat: number
          lon: number
          name?: string | null
          type: Database["public"]["Enums"]["node_type"]
        }
        Update: {
          biome?: Database["public"]["Enums"]["biome"]
          county_id?: number | null
          created_at?: string
          id?: never
          lat?: number
          lon?: number
          name?: string | null
          type?: Database["public"]["Enums"]["node_type"]
        }
        Relationships: [
          {
            foreignKeyName: "nodes_county_id_fkey"
            columns: ["county_id"]
            isOneToOne: false
            referencedRelation: "counties"
            referencedColumns: ["id"]
          },
        ]
      }
      offices: {
        Row: {
          county_id: number | null
          created_at: string
          duchy_id: number | null
          holder_character_id: string | null
          holder_since: string | null
          id: number
          kind: Database["public"]["Enums"]["office_kind"]
          kingdom_id: number | null
          npc_holder_name: string | null
        }
        Insert: {
          county_id?: number | null
          created_at?: string
          duchy_id?: number | null
          holder_character_id?: string | null
          holder_since?: string | null
          id?: never
          kind: Database["public"]["Enums"]["office_kind"]
          kingdom_id?: number | null
          npc_holder_name?: string | null
        }
        Update: {
          county_id?: number | null
          created_at?: string
          duchy_id?: number | null
          holder_character_id?: string | null
          holder_since?: string | null
          id?: never
          kind?: Database["public"]["Enums"]["office_kind"]
          kingdom_id?: number | null
          npc_holder_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offices_county_id_fkey"
            columns: ["county_id"]
            isOneToOne: true
            referencedRelation: "counties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offices_duchy_id_fkey"
            columns: ["duchy_id"]
            isOneToOne: true
            referencedRelation: "duchies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offices_holder_character_id_fkey"
            columns: ["holder_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offices_kingdom_id_fkey"
            columns: ["kingdom_id"]
            isOneToOne: true
            referencedRelation: "kingdoms"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          locale: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          locale?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          locale?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "auth.users"
            referencedColumns: ["id"]
          },
        ]
      }
      religions: {
        Row: {
          id: string
          name: string
          sort: number
        }
        Insert: {
          id: string
          name: string
          sort?: number
        }
        Update: {
          id?: string
          name?: string
          sort?: number
        }
        Relationships: []
      }
      roads: {
        Row: {
          created_at: string
          id: number
          node_a: number
          node_b: number
        }
        Insert: {
          created_at?: string
          id?: never
          node_a: number
          node_b: number
        }
        Update: {
          created_at?: string
          id?: never
          node_a?: number
          node_b?: number
        }
        Relationships: [
          {
            foreignKeyName: "roads_node_a_fkey"
            columns: ["node_a"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roads_node_b_fkey"
            columns: ["node_b"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_clan_invite: {
        Args: { p_clan_id: string }
        Returns: undefined
      }
      cancel_clan_invite: {
        Args: { p_character_id: string }
        Returns: undefined
      }
      create_clan: {
        Args: { p_name: string }
        Returns: string
      }
      decline_clan_invite: {
        Args: { p_clan_id: string }
        Returns: undefined
      }
      get_world_map: {
        Args: never
        Returns: Json
      }
      invite_to_clan: {
        Args: { p_character_id: string }
        Returns: undefined
      }
      kick_from_clan: {
        Args: { p_character_id: string }
        Returns: undefined
      }
      leave_clan: {
        Args: never
        Returns: undefined
      }
      map_create_county: {
        Args: { p_points: Json; p_name?: string; p_county_id?: number }
        Returns: Json
      }
      map_create_node: {
        Args: { p_lon: number; p_lat: number; p_type: Database["public"]["Enums"]["node_type"]; p_biome: Database["public"]["Enums"]["biome"]; p_name?: string; p_county_id?: number; p_from_node_id?: number }
        Returns: Json
      }
      map_delete_county: {
        Args: { p_county_id: number }
        Returns: Json
      }
      map_delete_point: {
        Args: { p_point_id: number }
        Returns: Json
      }
      map_merge_points: {
        Args: { p_from: number; p_into: number }
        Returns: Json
      }
      map_split_edge: {
        Args: { p_edge_id: number; p_lon: number; p_lat: number }
        Returns: Json
      }
      map_update_node: {
        Args: { p_node_id: number; p_lon: number; p_lat: number; p_type: Database["public"]["Enums"]["node_type"]; p_biome: Database["public"]["Enums"]["biome"]; p_name?: string; p_county_id?: number }
        Returns: Json
      }
      transfer_clan_leadership: {
        Args: { p_character_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin"
      biome: "plains" | "forest" | "hills" | "mountains" | "steppe" | "marsh" | "coast" | "desert"
      election_status: "scheduled" | "open" | "closed"
      node_type: "town" | "castle" | "mine" | "farm" | "monastery" | "road" | "crossroads" | "ford" | "pass" | "forest"
      office_kind: "mayor" | "duke" | "king"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
      biome: ["plains", "forest", "hills", "mountains", "steppe", "marsh", "coast", "desert"],
      election_status: ["scheduled", "open", "closed"],
      node_type: ["town", "castle", "mine", "farm", "monastery", "road", "crossroads", "ford", "pass", "forest"],
      office_kind: ["mayor", "duke", "king"],
    },
  },
} as const
