import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const SEED_PATIENTS = [
  {
    name: 'João da Silva',
    age: 34,
    profession: 'Professor',
    last_visit: '2024-10-30',
    status: 'retorno',
    diagnoses: [
      { code: 'F32.1', description: 'Episódio depressivo moderado' },
      { code: 'G47.0', description: 'Insônia não orgânica' },
    ],
    medications: [
      { name: 'Sertralina', dosage: '50mg', instructions: '1cp manhã', startedAt: '2024-09-15' },
      { name: 'Zolpidem', dosage: '10mg', instructions: 'Se necessário', startedAt: '2024-10-01' },
    ],
    allergies: ['Dipirona'],
    social_anamnesis: 'Paciente casado, 2 filhos. Trabalha como Professor (alto estresse). Não tabagista. Etilista social. Pratica caminhada 2x por semana. Alimentação irregular devido à rotina de trabalho.',
    medical_history: 'Cirurgia de apêndice em 2015. Histórico familiar de diabetes (Mãe). Pai com hipertensão controlada. Nega doenças cardíacas na família. Vacinação em dia.',
  },
  {
    name: 'Maria Oliveira',
    age: 45,
    profession: 'Advogada',
    last_visit: '2024-11-15',
    status: 'retorno',
    diagnoses: [
      { code: 'F41.1', description: 'Transtorno de ansiedade generalizada' },
    ],
    medications: [
      { name: 'Escitalopram', dosage: '10mg', instructions: '1cp manhã', startedAt: '2024-06-20' },
    ],
    allergies: [],
    social_anamnesis: 'Divorciada, 1 filha adolescente. Advogada sênior em escritório de grande porte. Trabalha 10-12h/dia. Pratica yoga 1x por semana. Não tabagista. Não etilista.',
    medical_history: 'Sem cirurgias prévias. Histórico familiar de ansiedade (Mãe). Sem outras comorbidades. Vacinação em dia.',
  },
  {
    name: 'Carlos Santos',
    age: 52,
    profession: 'Engenheiro',
    last_visit: '2024-11-20',
    status: 'seguimento',
    diagnoses: [
      { code: 'F33.0', description: 'Transtorno depressivo recorrente' },
    ],
    medications: [
      { name: 'Venlafaxina', dosage: '75mg', instructions: '1cp manhã', startedAt: '2024-02-10' },
      { name: 'Quetiapina', dosage: '25mg', instructions: '1cp noite', startedAt: '2024-08-05' },
    ],
    allergies: ['Sulfa', 'Penicilina'],
    social_anamnesis: 'Casado, 3 filhos adultos. Engenheiro civil autônomo. Histórico de períodos de alto estresse por projetos. Ex-tabagista (parou há 5 anos). Sem uso de álcool.',
    medical_history: 'Hipertensão controlada com Losartana. Apendicectomia em 2000. Histórico familiar de depressão (Pai e irmã). Colonoscopia normal em 2023.',
  },
  {
    name: 'Ana Beatriz Costa',
    age: 28,
    profession: 'Designer',
    last_visit: '2024-11-25',
    status: 'retorno',
    diagnoses: [
      { code: 'F40.1', description: 'Fobia social' },
    ],
    medications: [
      { name: 'Paroxetina', dosage: '20mg', instructions: '1cp manhã', startedAt: '2024-10-12' },
    ],
    allergies: [],
    social_anamnesis: 'Solteira, mora sozinha. Trabalha como designer freelancer (home office). Introvertida, círculo social pequeno. Não pratica atividade física regularmente. Não tabagista. Não etilista.',
    medical_history: 'Sem comorbidades. Sem cirurgias. Histórico familiar de ansiedade (Mãe). Vacinação em dia.',
  },
  {
    name: 'Roberto Almeida',
    age: 61,
    profession: 'Aposentado',
    last_visit: '2024-11-28',
    status: 'seguimento',
    diagnoses: [
      { code: 'F32.0', description: 'Episódio depressivo leve' },
      { code: 'F51.0', description: 'Insônia primária' },
    ],
    medications: [
      { name: 'Mirtazapina', dosage: '30mg', instructions: '1cp noite', startedAt: '2024-11-01' },
    ],
    allergies: ['AAS'],
    social_anamnesis: 'Viúvo há 2 anos. Aposentado de empresa pública. 2 filhos adultos que moram em outra cidade. Isolamento social progressivo após viuvez. Não tabagista. Nega etilismo.',
    medical_history: 'Diabetes tipo 2 controlado. Hipertensão. Histórico de IAM em 2019 (revascularizado). Alergia a AAS confirmada por reação prévia.',
  },
];

export function useSeedPatients(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    seedIfEmpty(userId);
  }, [userId]);
}

async function seedIfEmpty(userId: string) {
  const { count } = await supabase
    .from('patients')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (count !== 0) return;

  const rows = SEED_PATIENTS.map((p) => ({
    ...p,
    user_id: userId,
    diagnoses: p.diagnoses as any,
    medications: p.medications as any,
  }));

  await supabase.from('patients').insert(rows);
}
