export interface Patient {
  id: string;
  name: string;
  age: number | null;
  dateOfBirth?: string;
  revision?: number;
  profession: string;
  photoUrl?: string;
  lastVisit: string | null;
  status: 'retorno' | 'seguimento' | 'novo' | 'atendimento';
  diagnoses: Diagnosis[];
  medications: Medication[];
  allergies: string[];
  socialAnamnesis?: string;
  medicalHistory?: string;
  phone?: string;
  email?: string;
}

export interface Diagnosis {
  code: string;
  description: string;
}

export interface Medication {
  name: string;
  dosage: string;
  instructions: string;
  /** Data de início do uso (ISO). Usado para exibir "há X tempo em uso". */
  startedAt?: string;
}

export interface Appointment {
  id: string;
  userId: string;
  patientId: string | null;
  title: string;
  startTime: Date;
  endTime: Date;
  type: 'novo' | 'retorno' | 'seguimento' | 'urgencia';
  notes?: string;
  status: 'agendado' | 'confirmado' | 'cancelado' | 'realizado';
  googleEventId?: string;
  googleSyncStatus?: 'idle' | 'pending' | 'synced' | 'failed';
  googleSyncError?: string;
  reminderSent: boolean;
}

export interface ProfileUpdates {
  diagnoses:   Array<{ description: string }>;
  medications: Array<{ name: string; dosage: string; instructions: string }>;
  allergies:   string[];
}

export interface ChatMessage {
  id: string;
  type: 'soap' | 'whatsapp' | 'system' | 'user' | 'assistant' | 'profile-update';
  title: string;
  content: string;
  timestamp: Date;
  profileUpdates?: ProfileUpdates;
  /** For 'soap' messages: the consultation row this note was saved to. */
  consultationId?: string;
  sources?: Array<{id:string;type:string;label:string;date:string;excerpt:string;truncated?:boolean;sourceVersion?:string;sourceReference?:string;reviewedBy?:string;reviewedAt?:string;ownerUserId?:string;shared?:boolean;authorizationRevision?:number;sourceReviewRevision?:number;reviewStatus?:string}>;
  coverage?: {consultationsTotal?:number;documentsTotal?:number;consultationsRetrieved?:number;documentsRetrieved?:number;limited?:boolean};
}
