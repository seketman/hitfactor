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
      ammunition_types: {
        Row: {
          brand: string | null
          bullet_type: string | null
          bullet_weight_grains: number | null
          caliber: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          owner_user_id: string
          power_factor: string | null
          power_factor_measured: number | null
          powder: string | null
          powder_charge_grains: number | null
          type: string
          updated_at: string
        }
        Insert: {
          brand?: string | null
          bullet_type?: string | null
          bullet_weight_grains?: number | null
          caliber?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          owner_user_id: string
          power_factor?: string | null
          power_factor_measured?: number | null
          powder?: string | null
          powder_charge_grains?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          brand?: string | null
          bullet_type?: string | null
          bullet_weight_grains?: number | null
          caliber?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          owner_user_id?: string
          power_factor?: string | null
          power_factor_measured?: number | null
          powder?: string | null
          powder_charge_grains?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      clubs: {
        Row: {
          code: string
          country: string | null
          created_at: string
          name: string
          zone: string | null
        }
        Insert: {
          code: string
          country?: string | null
          created_at?: string
          name: string
          zone?: string | null
        }
        Update: {
          code?: string
          country?: string | null
          created_at?: string
          name?: string
          zone?: string | null
        }
        Relationships: []
      }
      disciplines: {
        Row: {
          code: string
          id: number
          name: string
          scoring_type: string
        }
        Insert: {
          code: string
          id?: number
          name: string
          scoring_type: string
        }
        Update: {
          code?: string
          id?: number
          name?: string
          scoring_type?: string
        }
        Relationships: []
      }
      divisions: {
        Row: {
          code: string
          discipline_id: number
          id: number
          name: string
        }
        Insert: {
          code: string
          discipline_id: number
          id?: number
          name: string
        }
        Update: {
          code?: string
          discipline_id?: number
          id?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "divisions_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          admin_note: string | null
          created_at: string
          id: number
          message: string
          page_url: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: number
          message: string
          page_url?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: number
          message?: string
          page_url?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      firearms: {
        Row: {
          brand: string | null
          caliber: string | null
          created_at: string
          id: string
          model: string | null
          name: string
          notes: string | null
          owner_user_id: string
          qr_code: string
          updated_at: string
        }
        Insert: {
          brand?: string | null
          caliber?: string | null
          created_at?: string
          id?: string
          model?: string | null
          name: string
          notes?: string | null
          owner_user_id: string
          qr_code?: string
          updated_at?: string
        }
        Update: {
          brand?: string | null
          caliber?: string | null
          created_at?: string
          id?: string
          model?: string | null
          name?: string
          notes?: string | null
          owner_user_id?: string
          qr_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      firearm_usage_log: {
        Row: {
          ammunition_type_id: string | null
          created_at: string
          firearm_id: string
          id: string
          notes: string | null
          rounds_fired: number
          updated_at: string
          used_on: string
        }
        Insert: {
          ammunition_type_id?: string | null
          created_at?: string
          firearm_id: string
          id?: string
          notes?: string | null
          rounds_fired: number
          updated_at?: string
          used_on: string
        }
        Update: {
          ammunition_type_id?: string | null
          created_at?: string
          firearm_id?: string
          id?: string
          notes?: string | null
          rounds_fired?: number
          updated_at?: string
          used_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "firearm_usage_log_ammunition_type_id_fkey"
            columns: ["ammunition_type_id"]
            isOneToOne: false
            referencedRelation: "ammunition_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firearm_usage_log_firearm_id_fkey"
            columns: ["firearm_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id"]
          },
        ]
      }
      match_entries: {
        Row: {
          category: string | null
          classification: string | null
          created_at: string
          division_id: number
          hits: number | null
          id: string
          is_absent: boolean
          is_dq: boolean
          match_id: string
          match_percentage: number
          match_points: number
          place: number
          power_factor: string | null
          shooter_id: string
          total_time_seconds: number | null
        }
        Insert: {
          category?: string | null
          classification?: string | null
          created_at?: string
          division_id: number
          hits?: number | null
          id?: string
          is_absent?: boolean
          is_dq?: boolean
          match_id: string
          match_percentage?: number
          match_points?: number
          place: number
          power_factor?: string | null
          shooter_id: string
          total_time_seconds?: number | null
        }
        Update: {
          category?: string | null
          classification?: string | null
          created_at?: string
          division_id?: number
          hits?: number | null
          id?: string
          is_absent?: boolean
          is_dq?: boolean
          match_id?: string
          match_percentage?: number
          match_points?: number
          place?: number
          power_factor?: string | null
          shooter_id?: string
          total_time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_entries_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_entries_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_entries_shooter_id_fkey"
            columns: ["shooter_id"]
            isOneToOne: false
            referencedRelation: "shooters"
            referencedColumns: ["id"]
          },
        ]
      }
      match_firearm_log: {
        Row: {
          ammunition_type_id: string | null
          created_at: string
          firearm_id: string
          match_entry_id: string
          notes: string | null
          rounds_fired: number
          updated_at: string
        }
        Insert: {
          ammunition_type_id?: string | null
          created_at?: string
          firearm_id: string
          match_entry_id: string
          notes?: string | null
          rounds_fired?: number
          updated_at?: string
        }
        Update: {
          ammunition_type_id?: string | null
          created_at?: string
          firearm_id?: string
          match_entry_id?: string
          notes?: string | null
          rounds_fired?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_firearm_log_ammunition_type_id_fkey"
            columns: ["ammunition_type_id"]
            isOneToOne: false
            referencedRelation: "ammunition_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_firearm_log_firearm_id_fkey"
            columns: ["firearm_id"]
            isOneToOne: false
            referencedRelation: "firearms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_firearm_log_match_entry_id_fkey"
            columns: ["match_entry_id"]
            isOneToOne: true
            referencedRelation: "match_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          date: string
          discipline_id: number
          id: string
          import_notes: string | null
          imported_at: string
          imported_by_user_id: string
          name: string
          region: string | null
          source_filename: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          discipline_id: number
          id?: string
          import_notes?: string | null
          imported_at?: string
          imported_by_user_id: string
          name: string
          region?: string | null
          source_filename?: string | null
          source_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          discipline_id?: number
          id?: string
          import_notes?: string | null
          imported_at?: string
          imported_by_user_id?: string
          name?: string
          region?: string | null
          source_filename?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_region: string | null
          display_name: string
          full_name: string | null
          id: string
          is_admin: boolean
          member_number: string | null
          ui_prefs: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_region?: string | null
          display_name: string
          full_name?: string | null
          id: string
          is_admin?: boolean
          member_number?: string | null
          ui_prefs?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_region?: string | null
          display_name?: string
          full_name?: string | null
          id?: string
          is_admin?: boolean
          member_number?: string | null
          ui_prefs?: Json
          updated_at?: string
        }
        Relationships: []
      }
      shooters: {
        Row: {
          created_at: string
          full_name: string
          id: string
          linked_user_id: string | null
          member_number: string | null
          region: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          linked_user_id?: string | null
          member_number?: string | null
          region?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          linked_user_id?: string | null
          member_number?: string | null
          region?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stage_results: {
        Row: {
          created_at: string
          hit_factor: number | null
          hits: number | null
          id: string
          is_dq: boolean
          match_entry_id: string
          penalties: number | null
          place: number | null
          points: number | null
          stage_id: string
          stage_percentage: number
          stage_points: number
          time_seconds: number | null
        }
        Insert: {
          created_at?: string
          hit_factor?: number | null
          hits?: number | null
          id?: string
          is_dq?: boolean
          match_entry_id: string
          penalties?: number | null
          place?: number | null
          points?: number | null
          stage_id: string
          stage_percentage?: number
          stage_points?: number
          time_seconds?: number | null
        }
        Update: {
          created_at?: string
          hit_factor?: number | null
          hits?: number | null
          id?: string
          is_dq?: boolean
          match_entry_id?: string
          penalties?: number | null
          place?: number | null
          points?: number | null
          stage_id?: string
          stage_percentage?: number
          stage_points?: number
          time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_results_match_entry_id_fkey"
            columns: ["match_entry_id"]
            isOneToOne: false
            referencedRelation: "match_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_results_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stages: {
        Row: {
          created_at: string
          id: string
          match_id: string
          max_points: number | null
          name: string
          stage_number: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          max_points?: number | null
          name: string
          stage_number?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          max_points?: number | null
          name?: string
          stage_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      merge_duplicate_shooters: {
        Args: never
        Returns: {
          canonical_id: string
          duplicate_id: string
          entries_deleted: number
          entries_repointed: number
        }[]
      }
      my_discipline_counts: {
        Args: { p_user_id: string }
        Returns: {
          code: string
          count: number
          name: string
        }[]
      }
      resolve_firearm_qr_code: {
        Args: { p_code: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
