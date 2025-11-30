import { Patient, ChatMessage } from '@/types/patient';

export const mockPatients: Patient[] = [
  {
    id: '1',
    name: 'João da Silva',
    age: 34,
    profession: 'Professor',
    lastVisit: '2024-10-30',
    status: 'atendimento',
    diagnoses: [
      { code: 'F32.1', description: 'Episódio depressivo moderado' },
      { code: 'G47.0', description: 'Insônia não orgânica' },
    ],
    medications: [
      { name: 'Sertralina', dosage: '50mg', instructions: '1cp manhã' },
      { name: 'Zolpidem', dosage: '10mg', instructions: 'Se necessário' },
    ],
    allergies: ['Dipirona'],
  },
  {
    id: '2',
    name: 'Maria Oliveira',
    age: 45,
    profession: 'Advogada',
    lastVisit: '2024-11-15',
    status: 'retorno',
    diagnoses: [
      { code: 'F41.1', description: 'Transtorno de ansiedade generalizada' },
    ],
    medications: [
      { name: 'Escitalopram', dosage: '10mg', instructions: '1cp manhã' },
    ],
    allergies: [],
  },
  {
    id: '3',
    name: 'Carlos Santos',
    age: 52,
    profession: 'Engenheiro',
    lastVisit: '2024-11-20',
    status: 'seguimento',
    diagnoses: [
      { code: 'F33.0', description: 'Transtorno depressivo recorrente' },
    ],
    medications: [
      { name: 'Venlafaxina', dosage: '75mg', instructions: '1cp manhã' },
      { name: 'Quetiapina', dosage: '25mg', instructions: '1cp noite' },
    ],
    allergies: ['Sulfa', 'Penicilina'],
  },
  {
    id: '4',
    name: 'Ana Beatriz Costa',
    age: 28,
    profession: 'Designer',
    lastVisit: '2024-11-25',
    status: 'retorno',
    diagnoses: [
      { code: 'F40.1', description: 'Fobia social' },
    ],
    medications: [
      { name: 'Paroxetina', dosage: '20mg', instructions: '1cp manhã' },
    ],
    allergies: [],
  },
  {
    id: '5',
    name: 'Roberto Almeida',
    age: 61,
    profession: 'Aposentado',
    lastVisit: '2024-11-28',
    status: 'seguimento',
    diagnoses: [
      { code: 'F32.0', description: 'Episódio depressivo leve' },
      { code: 'F51.0', description: 'Insônia primária' },
    ],
    medications: [
      { name: 'Mirtazapina', dosage: '30mg', instructions: '1cp noite' },
    ],
    allergies: ['AAS'],
  },
];

export const mockChatMessages: ChatMessage[] = [
  {
    id: '1',
    type: 'soap',
    title: 'Evolução Clínica',
    content: `**S (Subjetivo):** Paciente refere melhora significativa do humor nas últimas 4 semanas. Relata que está conseguindo dormir melhor, acordando mais disposto. Nega ideação suicida. Refere que voltou a fazer caminhadas pela manhã.

**O (Objetivo):** Peso mantido em 78kg. PA: 120x80mmHg. Paciente apresenta-se com boa aparência, higiene adequada, humor eutímico, afeto modulado.

**A (Avaliação):** Depressão leve em remissão parcial. Boa resposta ao tratamento atual. Sem efeitos colaterais significativos.

**P (Plano):** Manter Sertralina 50mg/dia. Orientado a manter atividade física. Retorno em 60 dias. Solicitado hemograma de controle.`,
    timestamp: new Date(),
  },
  {
    id: '2',
    type: 'whatsapp',
    title: 'Sugestão de Mensagem (WhatsApp)',
    content: `Olá João! 👋

Ótimo te ver hoje na consulta. Aqui vai um resuminho:

✅ Mantivemos a Sertralina 50mg pela manhã
✅ Continue com as caminhadas - está fazendo muito bem!
📋 Lembre-se do hemograma que pedi

Se sentir tontura ou qualquer efeito diferente, me avise por aqui.

Próximo retorno em 60 dias. Cuide-se! 💙`,
    timestamp: new Date(),
  },
];

export const preBriefing = {
  title: 'Resumo Pré-Consulta',
  content: {
    returnInfo: 'Paciente retorna após 30 dias',
    previousComplaint: 'Queixa anterior: Insônia persistente',
    pending: 'Pendência: Trazer hemograma',
    alert: 'Alerta: Monitorar ganho de peso',
  },
};
