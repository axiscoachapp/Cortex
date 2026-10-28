import { supabase } from '@/integrations/supabase/client';

export interface ConsultationDraft {
  id: string;
  patientId: string;
  chiefComplaint: string;
  audioStoragePath: string | null;
  audioMimeType: string;
  status: 'processing' | 'review' | 'error';
  transcription: string;
  soapDraft: string;
  whatsappDraft: string;
  clarifications: string[];
  transcriptionQuality: 'good' | 'partial' | 'poor';
  differentialDiagnoses: string[];
  drugInteractionAlerts: string[];
  originalComments: string[];
  pendingComments?: string;
}

export async function saveConsultationDraft(userId: string, draft: ConsultationDraft): Promise<void> {
  const { error } = await supabase.from('consultation_drafts').upsert({
    id: draft.id, user_id: userId, patient_id: draft.patientId,
    chief_complaint: draft.chiefComplaint, audio_storage_path: draft.audioStoragePath,
    content: { ...draft }, status: draft.status, updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function loadConsultationDraft(userId: string, patientId: string): Promise<ConsultationDraft | null> {
  const { data, error } = await supabase.from('consultation_drafts').select('*')
    .eq('user_id', userId).eq('patient_id', patientId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const content = data.content as unknown as Partial<ConsultationDraft>;
  return {
    ...content, id: data.id, patientId, chiefComplaint: data.chief_complaint,
    audioStoragePath: data.audio_storage_path, audioMimeType: content.audioMimeType ?? 'audio/webm', status: data.status as ConsultationDraft['status'],
    transcription: content.transcription ?? '', soapDraft: content.soapDraft ?? '', whatsappDraft: content.whatsappDraft ?? '',
    clarifications: content.clarifications ?? [], transcriptionQuality: content.transcriptionQuality ?? 'poor',
    differentialDiagnoses: content.differentialDiagnoses ?? [], drugInteractionAlerts: content.drugInteractionAlerts ?? [], originalComments: content.originalComments ?? [],
  };
}
