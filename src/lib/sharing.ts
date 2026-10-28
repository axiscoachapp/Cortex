import { supabase } from '@/integrations/supabase/client';

export interface ClinicMembership { clinic_id: string; name: string; role: 'admin' | 'doctor'; status: 'invited' | 'active' | 'inactive' }
export interface ClinicMember { clinic_id: string; user_id: string; name: string; role: 'admin' | 'doctor'; status: 'invited' | 'active' | 'inactive' }
export interface ReceivedShare { patient_id: string; name: string; owner_name: string; permission: 'read' | 'contribute'; allow_download: boolean; revision: number; expires_at: string | null }
export interface GrantedShare { id: string; patient_id: string; patient_name: string; recipient_name: string; permission: 'read' | 'contribute'; allow_download: boolean; revoked_at: string | null; expires_at: string | null }
export interface SharingOverview { memberships: ClinicMembership[]; members: ClinicMember[]; received: ReceivedShare[]; granted: GrantedShare[] }
export interface SharedChart {
  permission: 'owner' | 'read' | 'contribute'; allow_download: boolean; authorization_revision: number;
  patient: { id: string; name: string; age: number | null; allergies: string[] | null; medications: unknown; diagnoses: unknown; clinical_notes: string | null; medical_history: string | null; social_anamnesis: string | null };
  consultations: { id: string; created_at: string; chief_complaint: string | null; soap_note: string | null; author_user_id: string }[];
  consultation_count: number;
  entries: { id: string; created_at: string; author_name: string; author_user_id: string; entry_type: string; content: string }[]; entry_count: number;
  files: { id: string; file_name: string; mime_type: string | null; created_at: string }[]; file_count: number;
  prescriptions: { id: string; created_at: string; status: string; expires_at: string }[];
  structured_history: { id: string; kind: string; title: string; content: string; details: Record<string, unknown>; status: string; created_at: string; updated_at: string; author_user_id: string; author_name: string }[];
  structured_history_count: number;
}

export class SharingError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
type SharingRpcName = 'sharing_overview' | 'get_shared_patient_chart' | 'check_shared_patient_access' | 'patient_sharing_audit'
  | 'create_clinic' | 'invite_clinic_doctor' | 'respond_clinic_invitation' | 'offboard_clinic_doctor'
  | 'grant_patient_share' | 'revoke_patient_share' | 'append_shared_chart_entry'
  | 'protocol_sharing_overview' | 'grant_protocol_share' | 'revoke_protocol_share' | 'get_shared_protocol' | 'check_shared_protocol_access';

// RPCs keep chart access in PostgreSQL; the legacy owner-only Supabase client
// never substitutes a recipient ID for an owner's identity.
export async function sharingRpc<T>(name: SharingRpcName, args?: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new SharingError('Não foi possível verificar o acesso a tempo. Tente novamente.', 'ACCESS_UNVERIFIED')); }, 10_000);
    });
    const request = supabase.rpc(name as never, args as never).abortSignal(controller.signal);
    const { data, error } = await Promise.race([request, timeout]);
    if (error) throw new SharingError(error.message || 'Não foi possível concluir a operação.', error.code);
    return data as T;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function sharedClinicalList(value: unknown): string {
  if (!Array.isArray(value)) return 'Não informado';
  return value.map(item => typeof item === 'string' ? item : item && typeof item === 'object'
    ? Object.entries(item).filter(([, val]) => typeof val === 'string' || typeof val === 'number').map(([key, val]) => `${key}: ${val}`).join(' · ') : '').filter(Boolean).join('\n') || 'Não informado';
}
