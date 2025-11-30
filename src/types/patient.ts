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
}

export interface Diagnosis {
  code: string;
  description: string;
}

export interface Medication {
  name: string;
  dosage: string;
  instructions: string;
}

export interface ChatMessage {
  id: string;
  type: 'soap' | 'whatsapp' | 'system' | 'user';
  title: string;
  content: string;
  timestamp: Date;
}
