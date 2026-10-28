export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          requested_at: string
          user_id: string
        }
        Insert: {
          requested_at?: string
          user_id: string
        }
        Update: {
          requested_at?: string
          user_id?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          created_at: string
          end_time: string
          google_event_id: string | null
          id: string
          notes: string | null
          patient_id: string | null
          reminder_sent: boolean | null
          start_time: string
          status: string | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          end_time: string
          google_event_id?: string | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          reminder_sent?: boolean | null
          start_time: string
          status?: string | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          end_time?: string
          google_event_id?: string | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          reminder_sent?: boolean | null
          start_time?: string
          status?: string | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_owner_fk"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      clinical_record_revisions: {
        Row: {
          created_at: string
          id: number
          patient_id: string
          record_id: string
          record_type: string
          revision: number
          snapshot: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          patient_id: string
          record_id: string
          record_type: string
          revision: number
          snapshot: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          patient_id?: string
          record_id?: string
          record_type?: string
          revision?: number
          snapshot?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_record_revisions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_drafts: {
        Row: {
          audio_storage_path: string | null
          chief_complaint: string
          content: Json
          id: string
          patient_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_storage_path?: string | null
          chief_complaint?: string
          content?: Json
          id?: string
          patient_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_storage_path?: string | null
          chief_complaint?: string
          content?: Json
          id?: string
          patient_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_drafts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_patient_owner_fk"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      consultations: {
        Row: {
          chief_complaint: string | null
          created_at: string
          id: string
          patient_id: string | null
          pre_briefing: Json | null
          revision: number
          soap_note: string | null
          transcription: string | null
          user_id: string
          whatsapp_message: string | null
        }
        Insert: {
          chief_complaint?: string | null
          created_at?: string
          id?: string
          patient_id?: string | null
          pre_briefing?: Json | null
          revision?: number
          soap_note?: string | null
          transcription?: string | null
          user_id: string
          whatsapp_message?: string | null
        }
        Update: {
          chief_complaint?: string | null
          created_at?: string
          id?: string
          patient_id?: string | null
          pre_briefing?: Json | null
          revision?: number
          soap_note?: string | null
          transcription?: string | null
          user_id?: string
          whatsapp_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_patient_owner_fk"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      document_templates: {
        Row: {
          content: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      google_oauth_transactions: {
        Row: {
          code_verifier: string
          expires_at: string
          redirect_uri: string
          state_hash: string
          user_id: string
        }
        Insert: {
          code_verifier: string
          expires_at?: string
          redirect_uri: string
          state_hash: string
          user_id: string
        }
        Update: {
          code_verifier?: string
          expires_at?: string
          redirect_uri?: string
          state_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          content: string
          document_id: string
          embedding: string | null
          id: number
          user_id: string
        }
        Insert: {
          content: string
          document_id: string
          embedding?: string | null
          id?: never
          user_id: string
        }
        Update: {
          content?: string
          document_id?: string
          embedding?: string | null
          id?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_document_owner_fk"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          char_count: number
          created_at: string
          id: string
          source_type: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          char_count?: number
          created_at?: string
          id?: string
          source_type?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          char_count?: number
          created_at?: string
          id?: string
          source_type?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      medication_catalog: {
        Row: {
          active_ingredient: string | null
          anvisa_registration: string | null
          company: string | null
          id: number
          is_antimicrobial: boolean
          product_name: string
          regulatory_category: string | null
          therapeutic_class: string | null
        }
        Insert: {
          active_ingredient?: string | null
          anvisa_registration?: string | null
          company?: string | null
          id?: never
          is_antimicrobial?: boolean
          product_name: string
          regulatory_category?: string | null
          therapeutic_class?: string | null
        }
        Update: {
          active_ingredient?: string | null
          anvisa_registration?: string | null
          company?: string | null
          id?: never
          is_antimicrobial?: boolean
          product_name?: string
          regulatory_category?: string | null
          therapeutic_class?: string | null
        }
        Relationships: []
      }
      patient_files: {
        Row: {
          ai_summary: string | null
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          patient_id: string
          size_bytes: number | null
          storage_path: string
          tag: string | null
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          patient_id: string
          size_bytes?: number | null
          storage_path: string
          tag?: string | null
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          patient_id?: string
          size_bytes?: number | null
          storage_path?: string
          tag?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_files_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_files_patient_owner_fk"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      patients: {
        Row: {
          age: number
          ai_insights: Json | null
          allergies: string[] | null
          clinical_notes: string | null
          created_at: string
          deletion_requested_at: string | null
          diagnoses: Json | null
          email: string | null
          id: string
          last_visit: string
          medical_history: string | null
          medications: Json | null
          name: string
          phone: string | null
          photo_url: string | null
          profession: string | null
          revision: number
          social_anamnesis: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          age: number
          ai_insights?: Json | null
          allergies?: string[] | null
          clinical_notes?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          diagnoses?: Json | null
          email?: string | null
          id?: string
          last_visit: string
          medical_history?: string | null
          medications?: Json | null
          name: string
          phone?: string | null
          photo_url?: string | null
          profession?: string | null
          revision?: number
          social_anamnesis?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number
          ai_insights?: Json | null
          allergies?: string[] | null
          clinical_notes?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          diagnoses?: Json | null
          email?: string | null
          id?: string
          last_visit?: string
          medical_history?: string | null
          medications?: Json | null
          name?: string
          phone?: string | null
          photo_url?: string | null
          profession?: string | null
          revision?: number
          social_anamnesis?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prescriptions: {
        Row: {
          consultation_id: string | null
          content: Json | null
          created_at: string
          doc_type: string
          expires_at: string
          id: string
          issuance_verified_at: string | null
          medications: Json
          patient_id: string
          secret_code: string
          signature_verified_at: string | null
          signed_at: string | null
          status: string
          storage_path: string
          user_id: string
        }
        Insert: {
          consultation_id?: string | null
          content?: Json | null
          created_at?: string
          doc_type?: string
          expires_at: string
          id: string
          issuance_verified_at?: string | null
          medications?: Json
          patient_id: string
          secret_code: string
          signature_verified_at?: string | null
          signed_at?: string | null
          status?: string
          storage_path: string
          user_id: string
        }
        Update: {
          consultation_id?: string | null
          content?: Json | null
          created_at?: string
          doc_type?: string
          expires_at?: string
          id?: string
          issuance_verified_at?: string | null
          medications?: Json
          patient_id?: string
          secret_code?: string
          signature_verified_at?: string | null
          signed_at?: string | null
          status?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_consultation_owner_fk"
            columns: ["consultation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_owner_fk"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      usage_daily: {
        Row: {
          calls: number
          credits_reserved: number
          credits_used: number
          day: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calls?: number
          credits_reserved?: number
          credits_used?: number
          day: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calls?: number
          credits_reserved?: number
          credits_used?: number
          day?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_reservations: {
        Row: {
          actual: number | null
          created_at: string
          day: string
          id: string
          reserved: number
          settled: boolean
          user_id: string
        }
        Insert: {
          actual?: number | null
          created_at?: string
          day: string
          id: string
          reserved: number
          settled?: boolean
          user_id: string
        }
        Update: {
          actual?: number | null
          created_at?: string
          day?: string
          id?: string
          reserved?: number
          settled?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_reservations_user_id_day_fkey"
            columns: ["user_id", "day"]
            isOneToOne: false
            referencedRelation: "usage_daily"
            referencedColumns: ["user_id", "day"]
          },
        ]
      }
      user_integrations: {
        Row: {
          created_at: string
          google_access_token: string | null
          google_calendar_id: string | null
          google_refresh_token: string | null
          google_token_expiry: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          google_access_token?: string | null
          google_calendar_id?: string | null
          google_refresh_token?: string | null
          google_token_expiry?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          google_access_token?: string | null
          google_calendar_id?: string | null
          google_refresh_token?: string | null
          google_token_expiry?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          active_template_id: string | null
          created_at: string
          crm_number: string | null
          crm_uf: string | null
          daily_credit_limit: number
          doctor_name: string | null
          live_copilot_enabled: boolean
          professional_address: string | null
          specialty: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_template_id?: string | null
          created_at?: string
          crm_number?: string | null
          crm_uf?: string | null
          daily_credit_limit?: number
          doctor_name?: string | null
          live_copilot_enabled?: boolean
          professional_address?: string | null
          specialty?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_template_id?: string | null
          created_at?: string
          crm_number?: string | null
          crm_uf?: string | null
          daily_credit_limit?: number
          doctor_name?: string | null
          live_copilot_enabled?: boolean
          professional_address?: string | null
          specialty?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_active_template_id_fkey"
            columns: ["active_template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      user_integration_status: {
        Row: {
          created_at: string | null
          google_calendar_id: string | null
          google_connected: boolean | null
          id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          google_calendar_id?: string | null
          google_connected?: never
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          google_calendar_id?: string | null
          google_connected?: never
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_clinical_comment: {
        Args: {
          p_addendum?: string
          p_consultation_id?: string
          p_expected_consultation_revision?: number
          p_expected_revision: number
          p_patient_id: string
          p_patient_patch: Json
          p_user_id: string
        }
        Returns: boolean
      }
      assert_deletion_scope: {
        Args: { p_patient_id?: string; p_user_id: string }
        Returns: boolean
      }
      consume_google_oauth_transaction: {
        Args: {
          p_redirect_uri: string
          p_state_hash: string
          p_user_id: string
        }
        Returns: string
      }
      get_integration_status: {
        Args: { p_user_id: string }
        Returns: {
          google_calendar_id: string
          google_connected: boolean
        }[]
      }
      has_foreign_deletion_children: {
        Args: { p_id: string; p_owner: string; p_table: string }
        Returns: boolean
      }
      is_canonical_storage_path: { Args: { p_path: string }; Returns: boolean }
      match_knowledge: {
        Args: {
          match_count?: number
          p_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          document_id: string
          similarity: number
        }[]
      }
      record_usage: {
        Args: { p_credits: number; p_user_id: string }
        Returns: number
      }
      reserve_usage: {
        Args: { p_credits: number; p_reservation_id: string; p_user_id: string }
        Returns: Json
      }
      revoke_prescription: { Args: { p_id: string }; Returns: undefined }
      save_document_review: {
        Args: {
          p_file_id: string
          p_profile_note: string
          p_summary: string
          p_user_id: string
        }
        Returns: undefined
      }
      settle_usage: {
        Args: { p_credits: number; p_reservation_id: string; p_user_id: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      storage_parent_is_live: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      storage_upload_allowed: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      update_user_settings: { Args: { p_patch: Json }; Returns: undefined }
      validate_security_boundaries: {
        Args: never
        Returns: {
          invalid_rows: number
          table_name: string
        }[]
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
