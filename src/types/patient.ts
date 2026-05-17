export interface Patient {
  id: string;
  name: string;
  age: number;
  profession: string;
  photoUrl?: string;
  lastVisit: string;
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
  reminderSent: boolean;
}

export interface ChatMessage {
  id: string;
  type: 'soap' | 'whatsapp' | 'system' | 'user' | 'assistant';
  title: string;
  content: string;
  timestamp: Date;
}
