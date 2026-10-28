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
    PostgrestVersion: "12"
  }
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
          google_sync_claim: string | null
          google_sync_error: string | null
          google_sync_lease_until: string | null
          google_sync_revision: number
          google_sync_status: string
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
          google_sync_claim?: string | null
          google_sync_error?: string | null
          google_sync_lease_until?: string | null
          google_sync_revision?: number
          google_sync_status?: string
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
          google_sync_claim?: string | null
          google_sync_error?: string | null
          google_sync_lease_until?: string | null
          google_sync_revision?: number
          google_sync_status?: string
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
      chart_access_audit: {
        Row: {
          action: string
          actor_user_id: string
          clinic_id: string | null
          created_at: string
          id: number
          owner_user_id: string | null
          patient_id: string | null
          resource_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          clinic_id?: string | null
          created_at?: string
          id?: never
          owner_user_id?: string | null
          patient_id?: string | null
          resource_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          clinic_id?: string | null
          created_at?: string
          id?: never
          owner_user_id?: string | null
          patient_id?: string | null
          resource_id?: string | null
        }
        Relationships: []
      }
      clinic_members: {
        Row: {
          clinic_id: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          role?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_members_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
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
      clinical_work_items: {
        Row: {
          content: string
          created_at: string
          details: Json
          due_date: string | null
          id: string
          kind: string
          patient_id: string
          revision: number
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          details?: Json
          due_date?: string | null
          id?: string
          kind: string
          patient_id: string
          revision?: number
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          details?: Json
          due_date?: string | null
          id?: string
          kind?: string
          patient_id?: string
          revision?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_work_items_patient_id_user_id_fkey"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      clinical_work_revisions: {
        Row: {
          created_at: string
          id: number
          item_id: string
          patient_id: string
          revision: number
          snapshot: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          item_id: string
          patient_id: string
          revision: number
          snapshot: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          item_id?: string
          patient_id?: string
          revision?: number
          snapshot?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_work_revisions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "clinical_work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_work_revisions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      consultation_drafts: {
        Row: {
          appointment_id: string | null
          audio_storage_path: string | null
          chief_complaint: string
          content: Json
          discard_requested_at: string | null
          id: string
          patient_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          audio_storage_path?: string | null
          chief_complaint?: string
          content?: Json
          discard_requested_at?: string | null
          id?: string
          patient_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          audio_storage_path?: string | null
          chief_complaint?: string
          content?: Json
          discard_requested_at?: string | null
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
            foreignKeyName: "draft_linked_appointment"
            columns: ["user_id", "patient_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["user_id", "patient_id", "id"]
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
          appointment_id: string | null
          chief_complaint: string | null
          created_at: string
          history_proposals: Json
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
          appointment_id?: string | null
          chief_complaint?: string | null
          created_at?: string
          history_proposals?: Json
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
          appointment_id?: string | null
          chief_complaint?: string | null
          created_at?: string
          history_proposals?: Json
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
            foreignKeyName: "consultation_linked_appointment"
            columns: ["user_id", "patient_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["user_id", "patient_id", "id"]
          },
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
      data_export_snapshots: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          manifest: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          manifest: Json
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          manifest?: Json
          user_id?: string
        }
        Relationships: []
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
          embedding_model: string | null
          id: string
          index_revision: number
          index_started_at: string | null
          indexed_at: string | null
          review_revision: number
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          source_reference: string | null
          source_text: string | null
          source_type: string
          source_version: string | null
          status: string
          supersedes_document_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          char_count?: number
          created_at?: string
          embedding_model?: string | null
          id?: string
          index_revision?: number
          index_started_at?: string | null
          indexed_at?: string | null
          review_revision?: number
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          source_reference?: string | null
          source_text?: string | null
          source_type?: string
          source_version?: string | null
          status?: string
          supersedes_document_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          char_count?: number
          created_at?: string
          embedding_model?: string | null
          id?: string
          index_revision?: number
          index_started_at?: string | null
          indexed_at?: string | null
          review_revision?: number
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          source_reference?: string | null
          source_text?: string | null
          source_type?: string
          source_version?: string | null
          status?: string
          supersedes_document_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_version_owner_fk"
            columns: ["supersedes_document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      knowledge_review_events: {
        Row: {
          action: string
          actor_name: string
          actor_user_id: string
          created_at: string
          document_id: string
          id: number
          user_id: string
        }
        Insert: {
          action: string
          actor_name: string
          actor_user_id: string
          created_at?: string
          document_id: string
          id?: never
          user_id: string
        }
        Update: {
          action?: string
          actor_name?: string
          actor_user_id?: string
          created_at?: string
          document_id?: string
          id?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_review_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_review_events_document_id_user_id_fkey"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id", "user_id"]
          },
        ]
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
      operation_rate_windows: {
        Row: {
          admissions: number
          operation: string
          user_id: string
          window_start: string
        }
        Insert: {
          admissions: number
          operation: string
          user_id: string
          window_start: string
        }
        Update: {
          admissions?: number
          operation?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      patient_files: {
        Row: {
          ai_profile_proposal: string | null
          ai_review_receipt: Json | null
          ai_review_status: string
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
          ai_profile_proposal?: string | null
          ai_review_receipt?: Json | null
          ai_review_status?: string
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
          ai_profile_proposal?: string | null
          ai_review_receipt?: Json | null
          ai_review_status?: string
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
      patient_shares: {
        Row: {
          allow_download: boolean
          clinic_id: string
          created_at: string
          expires_at: string | null
          id: string
          owner_user_id: string
          patient_id: string
          permission: string
          recipient_user_id: string
          revision: number
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          allow_download?: boolean
          clinic_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          owner_user_id: string
          patient_id: string
          permission: string
          recipient_user_id: string
          revision?: number
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          allow_download?: boolean
          clinic_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          owner_user_id?: string
          patient_id?: string
          permission?: string
          recipient_user_id?: string
          revision?: number
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_shares_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_shares_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_shares_patient_id_owner_user_id_fkey"
            columns: ["patient_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      patients: {
        Row: {
          age: number | null
          ai_insights: Json | null
          allergies: string[] | null
          clinical_notes: string | null
          created_at: string
          date_of_birth: string | null
          deletion_requested_at: string | null
          diagnoses: Json | null
          email: string | null
          id: string
          last_visit: string | null
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
          age?: number | null
          ai_insights?: Json | null
          allergies?: string[] | null
          clinical_notes?: string | null
          created_at?: string
          date_of_birth?: string | null
          deletion_requested_at?: string | null
          diagnoses?: Json | null
          email?: string | null
          id?: string
          last_visit?: string | null
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
          age?: number | null
          ai_insights?: Json | null
          allergies?: string[] | null
          clinical_notes?: string | null
          created_at?: string
          date_of_birth?: string | null
          deletion_requested_at?: string | null
          diagnoses?: Json | null
          email?: string | null
          id?: string
          last_visit?: string | null
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
          issuance_snapshot: Json | null
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
          issuance_snapshot?: Json | null
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
          issuance_snapshot?: Json | null
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
      protocol_shares: {
        Row: {
          clinic_id: string
          created_at: string
          document_id: string
          id: string
          owner_user_id: string
          recipient_user_id: string
          revision: number
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          document_id: string
          id?: string
          owner_user_id: string
          recipient_user_id: string
          revision?: number
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          document_id?: string
          id?: string
          owner_user_id?: string
          recipient_user_id?: string
          revision?: number
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_shares_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_shares_document_id_owner_user_id_fkey"
            columns: ["document_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      provider_file_cleanup: {
        Row: {
          created_at: string
          file_name: string
          id: string
          patient_id: string
          provider: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          patient_id: string
          provider: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          patient_id?: string
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_file_cleanup_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_file_cleanup_patient_id_user_id_fkey"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      provider_upload_leases: {
        Row: {
          created_at: string
          id: string
          patient_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          patient_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          patient_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_upload_leases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_upload_leases_patient_id_user_id_fkey"
            columns: ["patient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      shared_chart_entries: {
        Row: {
          actor_user_id: string
          author_name: string
          author_user_id: string
          content: string
          created_at: string
          entry_type: string
          id: string
          owner_user_id: string
          patient_id: string
        }
        Insert: {
          actor_user_id: string
          author_name: string
          author_user_id: string
          content: string
          created_at?: string
          entry_type: string
          id?: string
          owner_user_id: string
          patient_id: string
        }
        Update: {
          actor_user_id?: string
          author_name?: string
          author_user_id?: string
          content?: string
          created_at?: string
          entry_type?: string
          id?: string
          owner_user_id?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_chart_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_chart_entries_patient_id_owner_user_id_fkey"
            columns: ["patient_id", "owner_user_id"]
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
      active_protocol_grant: {
        Args: { p_actor_user_id: string; p_document_id: string }
        Returns: {
          clinic_id: string
          created_at: string
          document_id: string
          id: string
          owner_user_id: string
          recipient_user_id: string
          revision: number
          revoked_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "protocol_shares"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      active_shared_grant: {
        Args: { p_patient_id: string; p_user_id: string }
        Returns: {
          allow_download: boolean
          clinic_id: string
          created_at: string
          expires_at: string | null
          id: string
          owner_user_id: string
          patient_id: string
          permission: string
          recipient_user_id: string
          revision: number
          revoked_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_shares"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admit_operation: {
        Args: { p_operation: string; p_user_id: string }
        Returns: Json
      }
      append_shared_chart_entry: {
        Args: {
          p_content: string
          p_entry_type: string
          p_expected_authorization_revision: number
          p_patient_id: string
          p_request_id?: string
        }
        Returns: string
      }
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
      approve_medication_reconciliation: {
        Args: {
          p_item_id: string
          p_item_revision: number
          p_patient_revision: number
        }
        Returns: boolean
      }
      assert_deletion_scope: {
        Args: { p_patient_id?: string; p_user_id: string }
        Returns: boolean
      }
      assert_deletion_scope_legacy: {
        Args: { p_patient_id?: string; p_user_id: string }
        Returns: boolean
      }
      assert_session_assurance: { Args: never; Returns: undefined }
      authorize_protocol_sources: {
        Args: { p_actor_user_id: string; p_sources: Json }
        Returns: boolean
      }
      authorize_shared_file: {
        Args: {
          p_actor_user_id: string
          p_file_id: string
          p_record_access?: boolean
        }
        Returns: Json
      }
      begin_consultation_discard: {
        Args: { p_draft_id: string; p_user_id: string }
        Returns: Json
      }
      begin_knowledge_index: {
        Args: { p_document_id: string; p_user_id: string }
        Returns: Json
      }
      build_data_export_manifest: { Args: { p_user_id: string }; Returns: Json }
      check_export_file: {
        Args: {
          p_bucket: string
          p_export_id: string
          p_path: string
          p_user_id: string
        }
        Returns: boolean
      }
      check_shared_patient_access: {
        Args: { p_patient_id: string }
        Returns: Json
      }
      check_shared_protocol_access: {
        Args: { p_document_id: string }
        Returns: Json
      }
      claim_calendar_sync: {
        Args: { p_appointment_id: string; p_user_id: string }
        Returns: Json
      }
      clinical_account_writable: { Args: never; Returns: boolean }
      complete_consultation_metadata: {
        Args: {
          p_consultation_id: string
          p_patient_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      complete_data_export_snapshot: {
        Args: { p_export_id: string; p_user_id: string }
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
      create_clinic: { Args: { p_name: string }; Returns: string }
      create_data_export_snapshot: {
        Args: { p_user_id: string }
        Returns: Json
      }
      create_knowledge_source: {
        Args: {
          p_reference: string
          p_supersedes_document_id?: string
          p_text: string
          p_title: string
          p_version: string
        }
        Returns: string
      }
      finalize_manual_encounter: {
        Args: { p_item_id: string; p_revision: number }
        Returns: string
      }
      finish_calendar_sync: {
        Args: {
          p_appointment_id: string
          p_claim: string
          p_error?: string
          p_revision: number
          p_status: string
          p_user_id: string
        }
        Returns: boolean
      }
      finish_knowledge_index: {
        Args: {
          p_chunks: Json
          p_document_id: string
          p_failed?: boolean
          p_index_revision: number
          p_user_id: string
        }
        Returns: boolean
      }
      get_integration_status: {
        Args: { p_user_id: string }
        Returns: {
          google_calendar_id: string
          google_connected: boolean
        }[]
      }
      get_shared_patient_chart: {
        Args: { p_limit?: number; p_patient_id: string }
        Returns: Json
      }
      get_shared_protocol: { Args: { p_document_id: string }; Returns: Json }
      grant_patient_share: {
        Args: {
          p_allow_download?: boolean
          p_expires_at?: string
          p_patient_id: string
          p_permission: string
          p_recipient_user_id: string
        }
        Returns: string
      }
      grant_protocol_share: {
        Args: { p_document_id: string; p_recipient_user_id: string }
        Returns: string
      }
      has_foreign_deletion_children: {
        Args: { p_id: string; p_owner: string; p_table: string }
        Returns: boolean
      }
      invite_clinic_doctor: {
        Args: { p_clinic_id: string; p_email: string }
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
          authorization_revision: number
          content: string
          document_id: string
          reviewed_at: string
          similarity: number
          source_author: string
          source_owner_user_id: string
          source_reference: string
          source_review_revision: number
          source_title: string
          source_version: string
        }[]
      }
      offboard_clinic_doctor: {
        Args: { p_clinic_id: string; p_user_id: string }
        Returns: boolean
      }
      patient_sharing_audit: { Args: { p_patient_id: string }; Returns: Json }
      protocol_sharing_overview: {
        Args: { p_document_id?: string; p_limit?: number; p_search?: string }
        Returns: Json
      }
      record_usage: {
        Args: { p_credits: number; p_user_id: string }
        Returns: number
      }
      reserve_usage: {
        Args: { p_credits: number; p_reservation_id: string; p_user_id: string }
        Returns: Json
      }
      respond_clinic_invitation: {
        Args: { p_accept: boolean; p_clinic_id: string }
        Returns: boolean
      }
      retrieve_patient_context: {
        Args: { p_patient_id: string; p_question: string; p_user_id: string }
        Returns: Json
      }
      review_document_proposal: {
        Args: {
          p_accept: boolean
          p_expected_patient_revision: number
          p_file_id: string
          p_note: string
        }
        Returns: undefined
      }
      review_history_proposal: {
        Args: {
          p_accept: boolean
          p_consultation_id: string
          p_expected_consultation_revision: number
          p_expected_patient_revision: number
          p_medical_history: string
          p_social_anamnesis: string
        }
        Returns: undefined
      }
      review_knowledge_source: {
        Args: { p_approve: boolean; p_document_id: string }
        Returns: boolean
      }
      revoke_patient_share: { Args: { p_share_id: string }; Returns: boolean }
      revoke_prescription: { Args: { p_id: string }; Returns: undefined }
      revoke_protocol_share: { Args: { p_share_id: string }; Returns: boolean }
      save_document_review: {
        Args: {
          p_file_id: string
          p_profile_note: string
          p_summary: string
          p_user_id: string
        }
        Returns: undefined
      }
      session_assurance_ok: { Args: never; Returns: boolean }
      settle_usage: {
        Args: { p_credits: number; p_reservation_id: string; p_user_id: string }
        Returns: boolean
      }
      sharing_actor: { Args: never; Returns: string }
      sharing_overview: { Args: never; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      storage_parent_is_live: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      storage_parent_is_live_before_discard: {
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
      workspace_directory: { Args: { p_limit?: number }; Returns: Json }
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
