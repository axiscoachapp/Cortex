import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAS
// ─────────────────────────────────────────────────────────────────────────────

const SEED_PATIENTS = [
  {
    name: 'João da Silva',
    age: 34,
    profession: 'Professor',
    phone: '11987654321',
    email: 'joao.silva@email.com',
    last_visit: '2026-02-20',
    status: 'retorno',
    diagnoses: [
      { code: 'F32.1', description: 'Episódio depressivo moderado' },
      { code: 'G47.0', description: 'Insônia não orgânica' },
    ],
    medications: [
      { name: 'Sertralina', dosage: '50mg', instructions: '1cp manhã', startedAt: '2025-10-15' },
      { name: 'Zolpidem', dosage: '10mg', instructions: 'Se necessário ao deitar', startedAt: '2025-10-15' },
    ],
    allergies: ['Dipirona'],
    social_anamnesis: 'Casado, 2 filhos (7 e 10 anos). Professor de matemática em escola pública, turmas superlotadas. Rotina extensa: sai às 6h, volta às 19h. Não tabagista. Etilista social (1-2 cervejas no final de semana). Pratica caminhada 2x por semana. Alimentação irregular, costuma pular o almoço.',
    medical_history: 'Apendicectomia em 2015. Histórico familiar: Mãe com diabetes tipo 2, Pai com hipertensão e episódio depressivo. Nega outras comorbidades. Vacinação em dia. Exame físico sem alterações em outubro/2025.',
  },
  {
    name: 'Maria Oliveira',
    age: 45,
    profession: 'Advogada',
    phone: '21976543210',
    email: 'maria.oliveira@escritorio.com',
    last_visit: '2026-03-15',
    status: 'retorno',
    diagnoses: [
      { code: 'F41.1', description: 'Transtorno de ansiedade generalizada' },
      { code: 'F45.0', description: 'Transtorno de somatização' },
    ],
    medications: [
      { name: 'Escitalopram', dosage: '15mg', instructions: '1cp manhã', startedAt: '2025-11-08' },
      { name: 'Clonazepam', dosage: '0,5mg', instructions: '1cp à noite (uso pontual)', startedAt: '2026-01-20' },
    ],
    allergies: [],
    social_anamnesis: 'Divorciada há 3 anos, 1 filha de 17 anos. Sócia em escritório de advocacia trabalhista. Jornada de 10-12h/dia, inclusive fins de semana durante audiências. Pratica yoga 1x/semana. Ex-tabagista (parou há 8 anos). Nega etilismo. Refere dificuldade em "desligar" fora do trabalho.',
    medical_history: 'Sem cirurgias. Diagnóstico de gastrite funcional em 2022 (gastro). Histórico familiar: Mãe com TAG, Pai falecido de IAM. Nega alergias. Densitometria óssea normal (2024).',
  },
  {
    name: 'Carlos Santos',
    age: 52,
    profession: 'Engenheiro Civil',
    phone: '31965432109',
    email: 'carlos.santos@engeobra.com',
    last_visit: '2026-01-30',
    status: 'seguimento',
    diagnoses: [
      { code: 'F33.1', description: 'Transtorno depressivo recorrente, episódio moderado atual' },
      { code: 'I10', description: 'Hipertensão essencial (sob controle)' },
    ],
    medications: [
      { name: 'Venlafaxina XR', dosage: '150mg', instructions: '1cp manhã', startedAt: '2025-09-25' },
      { name: 'Quetiapina', dosage: '25mg', instructions: '1cp à noite', startedAt: '2025-11-18' },
      { name: 'Losartana', dosage: '50mg', instructions: '1cp manhã', startedAt: '2022-03-01' },
    ],
    allergies: ['Sulfa', 'Penicilina'],
    social_anamnesis: 'Casado há 26 anos, 3 filhos adultos. Engenheiro autônomo com empresa própria de 8 funcionários. Alto estresse por gestão de contratos e equipe. Ex-tabagista (parou há 5 anos após orientação cardiológica). Nega etilismo. Sedentário (tentou academia, não manteve). Dorme em média 5-6h/noite.',
    medical_history: 'Apendicectomia em 2000. Diagnóstico de HA desde 2022. Histórico familiar: Pai com depressão recorrente (2 internações), irmã com depressão. Colonoscopia normal (2023). Nega tabagismo atual. Alergia a sulfa e penicilina confirmadas clinicamente.',
  },
  {
    name: 'Ana Beatriz Costa',
    age: 28,
    profession: 'Designer Gráfica',
    phone: '41954321098',
    email: 'ana.beatriz@ateliedesign.com',
    last_visit: '2026-02-14',
    status: 'retorno',
    diagnoses: [
      { code: 'F40.1', description: 'Fobia social (transtorno de ansiedade social)' },
      { code: 'F41.0', description: 'Transtorno de pânico (episódios ocasionais)' },
    ],
    medications: [
      { name: 'Paroxetina', dosage: '20mg', instructions: '1cp manhã com alimento', startedAt: '2025-12-03' },
      { name: 'Propranolol', dosage: '10mg', instructions: 'SOS antes de situações de alto estresse', startedAt: '2025-12-03' },
    ],
    allergies: [],
    social_anamnesis: 'Solteira, mora sozinha em apartamento desde os 25 anos. Trabalha como freelancer (home office integral). Círculo social pequeno: 2-3 amigos próximos, contato principalmente por mensagem. Recusa convites sociais com frequência. Não tabagista. Bebe raramente (1-2x/ano em ocasiões especiais). Nega atividade física regular.',
    medical_history: 'Nega comorbidades. Sem cirurgias. Histórico familiar: Mãe com TAG tratada, avô paterno com depressão. Menarque aos 13 anos, ciclos irregulares. Exames gerais normais em novembro/2025.',
  },
  {
    name: 'Roberto Almeida',
    age: 61,
    profession: 'Aposentado (ex-contador)',
    phone: '51943210987',
    email: 'roberto.almeida@gmail.com',
    last_visit: '2026-03-28',
    status: 'seguimento',
    diagnoses: [
      { code: 'F32.0', description: 'Episódio depressivo leve' },
      { code: 'F51.0', description: 'Insônia primária' },
      { code: 'Z63.4', description: 'Luto complicado (perda conjugal)' },
    ],
    medications: [
      { name: 'Mirtazapina', dosage: '30mg', instructions: '1cp à noite', startedAt: '2026-01-10' },
      { name: 'Metformina', dosage: '850mg', instructions: '1cp almoço e jantar', startedAt: '2020-06-01' },
      { name: 'Enalapril', dosage: '10mg', instructions: '1cp manhã', startedAt: '2019-08-01' },
    ],
    allergies: ['AAS'],
    social_anamnesis: 'Viúvo há 2 anos (esposa faleceu de câncer de mama). 2 filhos adultos que moram em São Paulo e Curitiba. Aposentado há 3 anos. Isolamento social progressivo após viuvez — raramente sai de casa. Vizinhos relatam que "sumiu". Não tabagista. Nega etilismo. Sedentário. Come sozinho, com frequência perde refeições.',
    medical_history: 'DM tipo 2 desde 2020 (endócrino). Hipertensão desde 2018. IAM em 2019 (revascularizado com 2 stents). Alergia a AAS — reação prévia de broncoespasmo. Cardiologista acompanha semestralmente. Ecocardiograma 2025: FE 58%.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTATIONS
// Each entry references the patient by index in SEED_PATIENTS
// ─────────────────────────────────────────────────────────────────────────────

function buildConsultations(patientIds: string[], userId: string) {
  const [joaoId, mariaId, carlosId, anaId, robertoId] = patientIds;

  return [
    // ── JOÃO ──────────────────────────────────────────────────────────────

    {
      patient_id: joaoId, user_id: userId,
      chief_complaint: 'Insônia há 3 meses, humor deprimido e dificuldade de concentração no trabalho',
      created_at: '2025-10-15T09:00:00Z',
      transcription: `Médico: Bom dia João, pode me contar o que está acontecendo?
Paciente: Doutor, há uns 3 meses eu não estou dormindo direito. Fico na cama rodando, pensando em coisas do trabalho, nos alunos, nas provas que preciso corrigir. Quando consigo dormir é superficial.
Médico: E no seu humor, como você se sente?
Paciente: Cansado. Muito cansado. Perdi o ânimo pras coisas. Antes eu gostava de jogar bola com meus filhos no final de semana, agora não tenho energia pra nada. Minha esposa tá preocupada.
Médico: Você tem pensamentos de se machucar?
Paciente: Não, não. Nada disso. É mais um vazio mesmo.
Médico: Vou solicitar alguns exames e iniciar um tratamento. Vou prescrever Sertralina 50mg pela manhã e Zolpidem para as noites que você não conseguir dormir.`,
      soap_note: `**S (Subjetivo):** Paciente masculino, 34 anos, professor. Refere insônia há 3 meses com dificuldade de iniciar o sono e sono não reparador. Relata humor deprimido, anedonia (parou de jogar bola com filhos), fadiga intensa e dificuldade de concentração no trabalho. Nega ideação suicida ou homicida. Cônjuge preocupada com alteração comportamental.

**O (Objetivo):** Bom estado geral, normocorado, orientado. PA 122x78mmHg, FC 78bpm, Peso 81kg. Humor eutímico/subdeprimido ao exame, afeto discretamente embotado. Sem agitação psicomotora. Cognição preservada. Exame físico sem outras alterações relevantes.

**A (Avaliação):** Quadro compatível com Episódio Depressivo Moderado (F32.1) associado a Insônia não orgânica (G47.0). Fatores estressores identificados: sobrecarga laboral, turmas superlotadas. Afasta-se ideação suicida. Sem sintomas psicóticos.

**P (Plano):** Iniciado Sertralina 50mg 1cp manhã — orientar sobre latência terapêutica de 2-4 semanas e efeitos iniciais (náusea, ansiedade transitória). Zolpidem 10mg VO para noites de insônia intensa — uso não contínuo. Solicitado hemograma completo, TSH, glicemia de jejum e vitamina D. Orientações de higiene do sono. Retorno em 60 dias ou antes se necessário.`,
      whatsapp_message: `Olá João! 👋

Foi um prazer te atender hoje. Aqui vão os pontos principais:

💊 Iniciamos Sertralina 50mg — tome todo dia pela manhã, com ou sem comida. Nos primeiros dias pode sentir um pouco de enjoo ou nervosismo, isso é normal e passa.
💊 Zolpidem 10mg — use só quando realmente não conseguir dormir. Não é para usar todo dia.
🩸 Você tem pedido de exames — tente fazer até a próxima semana.
😴 Tente manter horários fixos de acordar, mesmo nos fins de semana.

Qualquer dúvida me chama! Retorno em 60 dias. Cuide-se! 💙`,
    },

    {
      patient_id: joaoId, user_id: userId,
      chief_complaint: 'Retorno — melhora parcial do humor, insônia ainda presente',
      created_at: '2025-12-10T10:30:00Z',
      transcription: `Médico: João, como foi esse período?
Paciente: Melhorou alguma coisa, doutor. Tô mais animado, voltei a jogar bola um pouco. Mas o sono ainda é ruim. Acordo de madrugada e fico acordado.
Médico: Quantas vezes por semana você está usando o Zolpidem?
Paciente: Uns 4 dias por semana.
Médico: E os exames, fez?
Paciente: Fiz sim. Trouxe aqui. TSH normal, hemograma normal. Vitamina D tava baixa — 18.
Médico: Vou repor a vitamina D. Sobre o sono, vamos manter a Sertralina e adicionar orientações mais específicas.`,
      soap_note: `**S (Subjetivo):** Paciente em retorno após 55 dias. Relata melhora parcial do humor — retomou atividades prazerosas (futebol com filhos). Insônia de manutenção persiste: acorda 2-3x por noite, dificuldade de voltar a dormir. Usando Zolpidem 4x/semana. Nega efeitos adversos à Sertralina. Traz resultados de exames.

**O (Objetivo):** Bom estado geral, normocorado. PA 118x76mmHg, Peso 80kg (-1kg). Hemograma normal. TSH 2,1 mUI/L (normal). Vitamina D 18 ng/mL (deficiência). Glicemia jejum 94 mg/dL. Humor mais elevado em relação à primeira consulta, afeto mais modulado.

**A (Avaliação):** Resposta parcial ao tratamento — melhora do humor, insônia de manutenção resistente. Deficiência de vitamina D identificada (pode contribuir para fadiga e humor). Uso de Zolpidem mais frequente que o ideal — orientar.

**P (Plano):** Manter Sertralina 50mg. Iniciar Vitamina D3 7000 UI/dia por 3 meses, depois manutenção. Orientar redução progressiva do Zolpidem para uso máximo 2x/semana. Reforço de higiene do sono: limitar telas 1h antes de dormir, temperatura do quarto, horário fixo. Retorno em 60 dias.`,
      whatsapp_message: `Oi João! 😊

Boa notícia: você está melhorando! Alguns pontos importantes:

✅ Continua com Sertralina 50mg todo dia pela manhã
💊 Vitamina D 7000 UI — 1 cápsula por dia (pode tomar junto com a Sertralina)
🌙 Zolpidem — tente reduzir para no máximo 2x por semana, só nas noites mais difíceis
📵 Tente parar o celular 1 hora antes de dormir — faz diferença real!

Retorno em 60 dias. Qualquer coisa me avisa! 💙`,
    },

    {
      patient_id: joaoId, user_id: userId,
      chief_complaint: 'Retorno — boa evolução geral, questiona possibilidade de reduzir medicação',
      created_at: '2026-02-20T09:00:00Z',
      transcription: `Médico: João, como você está?
Paciente: Bem melhor, doutor. Tô dormindo bem, umas 7h por noite. O humor tá estável. Parei o Zolpidem há 6 semanas.
Médico: Que ótimo! E no trabalho?
Paciente: Tá puxado como sempre, mas tô lidando melhor. Não fico ruminando tanto à noite.
Paciente: Doutor, posso parar a Sertralina? Tô me sentindo bem.
Médico: Entendo a vontade, mas recomendo manter por pelo menos mais 6 meses após a remissão. Interromper antes aumenta o risco de recaída. Vamos reavaliar em julho.`,
      soap_note: `**S (Subjetivo):** Paciente refere remissão dos sintomas depressivos. Sono normalizado (7h/noite, sem despertar). Descontinuou Zolpidem há 6 semanas espontaneamente, sem rebote. Retomou todas as atividades cotidianas e lazer. Questiona redução/suspensão da Sertralina.

**O (Objetivo):** Bom estado geral. PA 120x76mmHg, Peso 79kg. Humor eutímico, afeto modulado, psicomotricidade normal. Sem sinais de hipomanias. Vitamina D não refeita.

**A (Avaliação):** Remissão do episódio depressivo moderado. Boa adesão e resposta à Sertralina. Descontinuação bem-sucedida do Zolpidem. Manter antidepressivo por fase de continuação (mínimo 6 meses pós-remissão) para prevenir recaída.

**P (Plano):** Manter Sertralina 50mg por mais 6 meses (revisão prevista para julho/2026). Solicitar vitamina D de controle. Orientar sinais de alerta de recaída. Informar que redução futura será gradual. Retorno em 5 meses ou antes se sintomas retornarem.`,
      whatsapp_message: `João, que consulta boa hoje! 🎉

Você está muito bem — o trabalho está funcionando. Pontos importantes:

✅ Continue com Sertralina 50mg — ainda por mais 6 meses para garantir a recuperação completa
🩸 Refaça a vitamina D daqui a 3 meses
💡 Se notar os sintomas voltando (insônia, cansaço, desânimo), me avise logo

Próximo retorno em julho. Continue se cuidando! 💙`,
    },

    // ── MARIA ─────────────────────────────────────────────────────────────

    {
      patient_id: mariaId, user_id: userId,
      chief_complaint: 'Ansiedade intensa há 6 meses, palpitações, insônia e preocupação excessiva com trabalho',
      created_at: '2025-11-08T14:00:00Z',
      transcription: `Médico: Maria, pode me contar o que está acontecendo?
Paciente: Doutora, eu vivo ansiosa. É uma preocupação que não para. Com o escritório, com os processos, com minha filha, com tudo. Às vezes meu coração dispara, parece que vou ter um infarto.
Médico: Esses episódios de taquicardia são acompanhados de falta de ar?
Paciente: Sim, e formigamento nas mãos. Fiz cardio e o médico disse que o coração está bom. Disse que é ansiedade.
Médico: E o sono?
Paciente: Terrível. Fico pensando em casos, em prazos. Acordo às 3h e começo a trabalhar no celular.
Médico: Vou iniciar um tratamento específico para ansiedade.`,
      soap_note: `**S (Subjetivo):** Paciente feminina, 45 anos, advogada. Queixa de ansiedade generalizada há 6 meses com piora progressiva. Relata preocupação excessiva e incontrolável sobre múltiplos domínios (trabalho, filha, saúde). Episódios de taquicardia, falta de ar e parestesias em mãos — avaliação cardiológica sem alterações orgânicas. Insônia de iniciação e manutenção com uso do celular na madrugada. Irritabilidade aumentada com filha e sócios.

**O (Objetivo):** Bom estado geral, ansiosa durante a consulta. PA 132x84mmHg (atenção), FC 96bpm. Peso 68kg. Sem alterações neurológicas. Avaliação cardiológica prévia normal (ECG e eco normais). Discreta tensão muscular cervical.

**A (Avaliação):** Quadro compatível com Transtorno de Ansiedade Generalizada (F41.1). Sintomas somáticos associados (palpitações, parestesias) — descartar fisicamente já realizado. PA ligeiramente elevada — pode ser reacional à ansiedade; monitorar. Fatores perpetuadores: jornada excessiva, uso de celular noturno, dificuldade de desengajamento do trabalho.

**P (Plano):** Iniciado Escitalopram 10mg 1cp manhã — orientar latência de 2-4 semanas. Solicitado TSH, glicemia, hemograma completo e PA seriada (aferir 3x/semana por 2 semanas). Psicoeducação sobre TAG. Orientação: desligar notificações profissionais a partir das 20h. Retorno em 10 semanas.`,
      whatsapp_message: `Olá Maria!

Obrigada pela confiança. Aqui vão as orientações de hoje:

💊 Escitalopram 10mg — todo dia pela manhã. Nas primeiras 2 semanas pode sentir um pouco mais de ansiedade ou leve tontura — é passageiro e normal.
📱 Tente criar uma regra: zero celular profissional após as 20h. Sei que é difícil, mas é fundamental para o tratamento.
📊 Anote sua pressão por 2 semanas e me mande os valores.
🩸 Exames solicitados — tente fazer essa semana.

Qualquer dúvida me chama. Retorno em 10 semanas! 💙`,
    },

    {
      patient_id: mariaId, user_id: userId,
      chief_complaint: 'Retorno — melhora discreta da ansiedade, ainda com episódios noturnos e dores somáticas',
      created_at: '2026-01-20T15:00:00Z',
      transcription: `Médico: Maria, como foi o período?
Paciente: Melhorou um pouco, mas ainda tô ansiosa. Os episódios de coração acelerado diminuíram. Mas ainda acordo de madrugada pensando em tudo.
Médico: Conseguiu diminuir o celular à noite?
Paciente: Às vezes. Quando tenho audiência no dia seguinte, não consigo. Ai fico mexendo até meia-noite.
Médico: Os exames?
Paciente: TSH normal. Pressão melhorou — ficou em torno de 125x82. Mas tô com muito dor de estômago e de cabeça.
Médico: Essas queixas somáticas são frequentes no TAG. Vou ajustar a medicação e adicionar algo para as noites mais difíceis.`,
      soap_note: `**S (Subjetivo):** Retorno após 73 dias. Paciente relata melhora parcial da ansiedade — episódios de palpitações menos frequentes. Insônia de manutenção persiste (acorda 3-4h). Aderiu parcialmente à higiene digital. Novas queixas: cefaleia tensional 3-4x/semana e epigastralgia (investigando). PA controlada (média 126x82mmHg). Exames: TSH 1,8 (normal), hemograma normal, glicemia 96.

**O (Objetivo):** PA 128x80mmHg. Peso 67kg (-1kg). Tensão muscular cervical e occipital ao exame. Abdome sem dor à palpação profunda. Humor ansioso, afeto compatível. Autocrítica elevada sobre produtividade.

**A (Avaliação):** Resposta parcial ao Escitalopram 10mg. TAG com componente somático proeminente (cefaleia, epigastralgia). Considerar ajuste de dose. Insônia residual com padrão de despertar precoce. Perfeccionismo e dificuldade de desengajamento como fatores perpetuadores.

**P (Plano):** Aumentar Escitalopram para 15mg. Adicionar Clonazepam 0,5mg SOS ao deitar nas noites de grande dificuldade (máx 2x/semana). Encaminhar para psicoterapia TCC (reforço). Solicitar EDA se epigastralgia persistir. Retorno em 8 semanas.`,
      whatsapp_message: `Maria, boa evolução considerando a intensidade do início!

📈 Aumentamos o Escitalopram para 15mg — mantenha pela manhã normalmente
💊 Adicionamos Clonazepam 0,5mg para as noites mais difíceis — use com parcimônia, máx 2x/semana
🧠 Reforço: psicoterapia vai potencializar muito o tratamento — vou te passar indicações
🤢 Se a dor no estômago persistir mais de 2 semanas, me avise para pedirmos endoscopia

Retorno em 8 semanas. Você está no caminho certo! 💙`,
    },

    {
      patient_id: mariaId, user_id: userId,
      chief_complaint: 'Retorno — boa resposta ao ajuste de dose, mantendo sintomas residuais leves',
      created_at: '2026-03-15T14:30:00Z',
      transcription: `Médico: Maria, como está?
Paciente: Bem melhor dessa vez. A ansiedade ainda aparece, mas consigo respirar, colocar no lugar. Tô fazendo terapia e está ajudando muito.
Médico: E o sono?
Paciente: Melhorou. Uso o Clonazepam umas 2 vezes por semana, igual pediu.
Médico: O celular à noite?
Paciente: Consegui colocar um limite até meia-noite. Tô tentando reduzir mais. Minha filha me ajudou a configurar o modo foco.`,
      soap_note: `**S (Subjetivo):** Retorno após 54 dias. Paciente relata melhora significativa da ansiedade — descreve episódios menores e mais controláveis com técnicas de TCC aprendidas na terapia. Sono melhorado (dorme 6-7h). Usando Clonazepam 2x/semana conforme orientado. Reduziu uso de celular após meia-noite. Epigastralgia resolvida espontaneamente. Cefaleia tensional diminuiu para 1x/semana.

**O (Objetivo):** PA 124x78mmHg. Peso 67kg. Humor ansioso leve, afeto mais modulado que consultas anteriores. Tensão muscular cervical diminuída. Sem queixas somáticas agudas.

**A (Avaliação):** Boa resposta ao Escitalopram 15mg em combinação com psicoterapia. Sintomas residuais leves — ansiedade episódica manejável. Manter tratamento atual. Clonazepam sendo usado de forma controlada.

**P (Plano):** Manter Escitalopram 15mg. Manter Clonazepam 0,5mg SOS (max 2x/semana) — reavaliar em 3 meses necessidade de retirada gradual. Continuar psicoterapia TCC. Orientar sobre plano de redução futura da medicação após 12 meses estável. Retorno em 3 meses.`,
      whatsapp_message: `Maria, que consulta boa hoje! 🎉

Você está demonstrando uma evolução linda. Resumo:

✅ Escitalopram 15mg — mantém todo dia pela manhã
💊 Clonazepam — continue usando só quando precisar (máx 2x/semana)
🧠 Continue a terapia — está fazendo toda a diferença!
📱 Parabéns pelo progresso com o celular — continue reduzindo!

Próximo retorno em 3 meses. Muito orgulho do seu empenho! 💙`,
    },

    // ── CARLOS ────────────────────────────────────────────────────────────

    {
      patient_id: carlosId, user_id: userId,
      chief_complaint: 'Novo episódio depressivo — piora após término de projeto grande, insônia severa e anedonia',
      created_at: '2025-09-25T11:00:00Z',
      transcription: `Médico: Carlos, você mencionou que isso já aconteceu antes?
Paciente: Sim, doutor. Em 2019 tive uma depressão forte, fiquei afastado 3 meses. Tratei com fluoxetina, melhorei. Parei depois de um tempo.
Médico: E agora, o que desencadeou?
Paciente: Terminei um projeto grande em agosto, foi muito estressante. Quando acabou... eu esperava sentir alívio, mas senti um vazio. Fui piorando.
Médico: Está dormindo?
Paciente: Umas 4-5 horas, e ruim. Acordo cedo com a cabeça acelerada. Não tenho mais prazer em nada, nem na minha empresa.
Médico: Pensamentos de se machucar?
Paciente: Não, não chego nisso. Mas fico pensando que seria melhor se eu sumisse.`,
      soap_note: `**S (Subjetivo):** Paciente masculino, 52 anos, engenheiro civil. Segundo episódio depressivo (primeiro em 2019, tratado com fluoxetina). Episódio atual desencadeado por esgotamento pós-projeto intenso. Refere anedonia, humor deprimido há 6 semanas com piora progressiva, insônia terminal (acorda 4-5h), fadiga intensa, dificuldade de gestão da empresa. Refere pensamentos passivos de "sumir" — nega plano ou intenção suicida ativa.

**O (Objetivo):** Aspecto descuidado discreto. PA 138x88mmHg (elevada — em uso de Losartana). FC 84bpm. Peso 88kg. Humor hipoprósico, psicomotricidade lentificada, pensamento com latência aumentada. Sem alterações neurológicas. Insight preservado.

**A (Avaliação):** Transtorno depressivo recorrente (F33.1) — episódio atual moderado. Fatores de risco: histórico prévio, sobrecarga laboral crônica, sedentarismo, privação de sono. Ideação suicida passiva sem risco imediato — monitorar. PA elevada — comunicar clínico. Antecedente de resposta a ISRS (fluoxetina).

**P (Plano):** Iniciado Venlafaxina XR 75mg (ISRN — eficaz em depressão + ansiedade, pode ajudar no componente energético). Comunicar clínico sobre PA. Avaliação de risco suicida na próxima consulta. Orientação familiar (esposa). Solicitado hemograma, TSH, função renal e hepática. Retorno em 8 semanas.`,
      whatsapp_message: `Carlos, obrigado por ter vindo hoje. Sei que deu um passo importante.

💊 Iniciamos Venlafaxina 75mg — tome toda manhã com alimento. Nos primeiros dias pode sentir enjoo leve ou boca seca.
⚠️ Sua pressão está um pouco alta — avise seu clínico geral essa semana.
🩸 Faça os exames assim que puder.
👥 Converse com sua esposa sobre o que está sentindo — o apoio familiar é fundamental.

Se os pensamentos de "sumir" ficarem mais intensos, me ligue imediatamente ou vá a uma UPA. Estou disponível. Retorno em 8 semanas.`,
    },

    {
      patient_id: carlosId, user_id: userId,
      chief_complaint: 'Retorno — resposta parcial, insônia persiste, associando Quetiapina',
      created_at: '2025-11-18T11:00:00Z',
      transcription: `Médico: Carlos, como está?
Paciente: Um pouco melhor. O humor melhorou uns 30-40%, diria. Mas a insônia continua terrível. Acordo às 4h e não durmo mais.
Médico: Os pensamentos de sumir passaram?
Paciente: Passaram, sim. Tô mais esperançoso.
Médico: Os exames?
Paciente: TSH normal, hemograma ok. A função renal e hepática normais. Falei com o clínico, ele ajustou a losartana.
Médico: Vou adicionar uma medicação em dose baixa para ajudar o sono e potencializar o antidepressivo.`,
      soap_note: `**S (Subjetivo):** Retorno após 54 dias. Relata melhora parcial do humor (40% de melhora subjetiva). Insônia terminal persiste (acorda 3-4h sem voltar a dormir). Nega ideação suicida. Retomou algumas tarefas da empresa. Esposa confirmou melhora do comportamento. Exames normais. Clínico ajustou Losartana para 100mg.

**O (Objetivo):** PA 132x82mmHg (melhora). Peso 87kg. Humor levemente hipomítico, afeto mais responsivo que consulta anterior. Psicomotricidade normalizada. Sem alterações cognitivas significativas.

**A (Avaliação):** Resposta parcial à Venlafaxina 75mg. Insônia resistente como sintoma residual principal. Considerar potencialização. Melhora do risco suicida. PA sob melhor controle.

**P (Plano):** Aumentar Venlafaxina XR para 150mg. Adicionar Quetiapina 25mg à noite (potencialização do antidepressivo + sedação) — orientar sobre sedação matinal inicial. Retorno em 10 semanas.`,
      whatsapp_message: `Carlos, boa evolução! Vamos acelerar a melhora do sono.

📈 Aumentamos a Venlafaxina para 150mg
💊 Adicionamos Quetiapina 25mg — tome 30 min antes de dormir. Nos primeiros dias vai sentir sono extra de manhã — vai passando.
✅ Continue com Losartana conforme ajustado pelo seu clínico

Retorno em 10 semanas. Continue assim! 💙`,
    },

    {
      patient_id: carlosId, user_id: userId,
      chief_complaint: 'Retorno — melhora significativa, dormindo bem, voltou a exercitar-se',
      created_at: '2026-01-30T10:00:00Z',
      transcription: `Médico: Carlos, como está?
Paciente: Bem melhor, doutor. Tô dormindo umas 7 horas. Voltei a caminhar de manhã, umas 3 vezes por semana. A empresa tá rodando melhor.
Médico: E o humor?
Paciente: Estável. Me sinto parecido com como eu era antes disso tudo.
Médico: Ótimo. Podemos começar a pensar em manutenção. Dado seu histórico, recomendo manter o tratamento por pelo menos 2 anos.
Paciente: Tudo bem, doutor. Aprendi que não posso parar sozinho.`,
      soap_note: `**S (Subjetivo):** Retorno após 73 dias. Paciente relata remissão dos sintomas depressivos. Sono normalizado (7h, reparador). Retomou atividade física (caminhadas 3x/semana). Empresa estabilizada. Nega anedonia, ideação suicida ou sintomas prodrômicos. Aprendeu com episódio anterior sobre importância da manutenção.

**O (Objetivo):** PA 126x80mmHg. Peso 85kg (-2kg). Aparência cuidada. Humor eutímico, afeto modulado, psicomotricidade normal. Cognição e memória preservadas.

**A (Avaliação):** Remissão do segundo episódio depressivo moderado. Boa resposta ao esquema Venlafaxina 150mg + Quetiapina 25mg. Dado histórico de 2 episódios, indicada fase de manutenção prolongada (2 anos mínimo).

**P (Plano):** Manter Venlafaxina XR 150mg + Quetiapina 25mg. Retorno em 4 meses. Orientar sobre sinais prodrômicos de recaída. Estimular manutenção de atividade física. Discutir estratégia de retirada futura (gradual, supervisionada) no momento oportuno.`,
      whatsapp_message: `Carlos, excelente consulta hoje! 🎉

Você chegou num lugar muito bom. Mantemos o esquema atual:

✅ Venlafaxina 150mg — todo dia pela manhã
✅ Quetiapina 25mg — todo dia à noite
🏃 Parabéns pelas caminhadas — continue!
⚠️ Lembre: nunca pare as medicações sozinho. Se sentir que está bem, me chame e vamos planejar juntos.

Retorno em 4 meses. Orgulho da sua recuperação! 💙`,
    },

    // ── ANA ───────────────────────────────────────────────────────────────

    {
      patient_id: anaId, user_id: userId,
      chief_complaint: 'Evitamento social severo, crise de pânico em videochamadas de trabalho',
      created_at: '2025-12-03T16:00:00Z',
      transcription: `Médico: Ana, você pode me contar um pouco sobre o que está passando?
Paciente: Eu sempre fui tímida, desde criança. Mas nos últimos meses piorou muito. Comecei a ter crises quando preciso aparecer nas chamadas de trabalho. Meu coração acelera, eu trava, esqueço o que ia falar.
Médico: Você evita essas situações?
Paciente: Muito. Peço pra deixar câmera desligada, invento desculpas. Recusei um projeto porque tinha muita apresentação.
Médico: E no dia a dia, com amigos, família?
Paciente: Minha mãe reclama que sumo. Tenho 2 amigos que converso pelo Whatsapp, mas encontros presenciais... são raros. Sinto que vou ser julgada.
Médico: Vou iniciar um tratamento que combina medicação e, muito importante, psicoterapia.`,
      soap_note: `**S (Subjetivo):** Paciente feminina, 28 anos, designer freelancer. Queixa principal de ansiedade social severa com prejuízo funcional e profissional. Relata ansiedade antecipatória intensa antes de interações sociais, mesmo virtuais. Episódios de pânico situacional (taquicardia, bloqueio cognitivo, tremor). Comportamento de evitamento significativo: recusou projeto profissional, evita encontros presenciais, círculo social restrito a 2 pessoas por mensagem. Medo central de avaliação negativa e julgamento. Refere sintomas presentes desde a adolescência com piora nos últimos 6 meses (isolamento pós-pandemia perpetuado).

**O (Objetivo):** Bom estado geral, claramente ansiosa durante a entrevista, mantém pouco contato visual. PA 118x74mmHg. Peso 57kg. Sem alterações físicas. Cognição preservada. Insight sobre o problema presente.

**A (Avaliação):** Fobia social/Transtorno de Ansiedade Social (F40.1) com comprometimento funcional moderado a grave. Episódios de pânico situacional associados. Fatores de manutenção: home office, comportamentos de segurança (câmera desligada), evitamento progressivo.

**P (Plano):** Iniciado Paroxetina 20mg (ISRS com maior evidência para ansiedade social). Propranolol 10mg SOS pré-situações de alto estresse. Encaminhamento prioritário para TCC com exposição gradual. Psicoeducação sobre o ciclo da ansiedade e os efeitos paradoxais do evitamento. Retorno em 10 semanas.`,
      whatsapp_message: `Olá Ana! Fico feliz que tenha vindo 😊

Sei que dar esse passo já exigiu coragem — e isso diz muito sobre você.

💊 Paroxetina 20mg — tome todo dia pela manhã com alimento. Nos primeiros 10-14 dias a ansiedade pode aumentar um pouco antes de melhorar — isso é normal.
💊 Propranolol 10mg — use 30-60 min antes de situações que te deixem muito ansiosa (videochamadas importantes, etc.)
🧠 A psicoterapia é fundamental no seu caso — vou te mandar indicações de terapeutas com experiência em ansiedade social.

Qualquer dúvida me chama. Retorno em 10 semanas! 💙`,
    },

    {
      patient_id: anaId, user_id: userId,
      chief_complaint: 'Retorno — melhora leve, iniciou terapia, ainda com evitamento',
      created_at: '2026-02-14T16:00:00Z',
      transcription: `Médico: Ana, como foi esse período?
Paciente: Melhorou um pouco. Entrei em terapia, tô gostando. A terapeuta tá me fazendo exercícios de exposição gradual.
Médico: E as videochamadas?
Paciente: Ainda tenho muito medo, mas na última semana deixei a câmera ligada em uma reunião menor. Fiquei nervosa, mas consegui.
Médico: Isso é progresso enorme! E a medicação?
Paciente: Sim, os primeiros dias foram ruins — muito ansiosa, não dormia bem. Mas depois de umas 2 semanas melhorou. Agora tô mais tranquila em geral.`,
      soap_note: `**S (Subjetivo):** Retorno após 73 dias. Relata melhora leve-moderada da ansiedade social. Iniciou psicoterapia TCC (5 sessões) com exercícios de exposição gradual. Conseguiu manter câmera ligada em videochamada menor (primeiro passo de exposição significativo). Tolerou fase de piora inicial da Paroxetina. Uso ocasional de Propranolol em 3 situações. Ainda evita eventos sociais presenciais, mas com menos ansiedade antecipatória.

**O (Objetivo):** PA 116x72mmHg. Peso 57kg. Menos ansiosa durante a consulta em relação à primeira avaliação — manteve mais contato visual. Afeto mais responsivo.

**A (Avaliação):** Resposta inicial positiva à Paroxetina 20mg. Combinação medicação + TCC com exposição mostrando resultados precoces. Reforçar manutenção do tratamento e progressão das exposições.

**P (Plano):** Manter Paroxetina 20mg. Manter Propranolol SOS. Incentivar continuidade da TCC e progressão nas hierarquias de exposição. Orientar sobre normalização gradual dos sintomas com a exposição repetida. Retorno em 3 meses.`,
      whatsapp_message: `Ana, deixar a câmera ligada naquela reunião foi ENORME 🎉 Você não imagina o quanto isso significa clinicamente.

✅ Continua com Paroxetina 20mg todo dia
💊 Propranolol segue disponível quando precisar
🧠 Continue a terapia — você está no caminho certo
📈 Cada exposição que você faz, mesmo com medo, vai ensinando o seu cérebro que é seguro

Próximo retorno em 3 meses. Muito orgulho! 💙`,
    },

    // ── ROBERTO ───────────────────────────────────────────────────────────

    {
      patient_id: robertoId, user_id: userId,
      chief_complaint: 'Tristeza profunda após viuvez, insônia, perda de apetite e isolamento social',
      created_at: '2025-10-28T10:00:00Z',
      transcription: `Médico: Roberto, o que te trouxe aqui?
Paciente: Minha esposa faleceu há 2 anos, doutor. Câncer de mama. Ficamos juntos 38 anos. Depois que ela se foi... não sei. Não tenho mais vontade de nada.
Médico: Como é o seu dia a dia agora?
Paciente: Acordo, fico sentado. Não saio. Os filhos ligam, eu atendo, mas não falo muito. Não consigo sentir alegria em nada. Antes gostava de pescar, de ler... agora nada me interessa.
Médico: E o sono?
Paciente: Péssimo. Acordo às 2h, 3h. Fico pensando nela, no que era antes. Às vezes choro sozinho.
Médico: Você pensa em se machucar ou em não querer mais viver?
Paciente: Penso que seria melhor estar com ela. Mas não farei nada, tenho os filhos.`,
      soap_note: `**S (Subjetivo):** Paciente masculino, 61 anos, aposentado. Viúvo há 2 anos após perda conjugal de 38 anos (esposa — câncer de mama). Refere tristeza persistente, anedonia global, isolamento social progressivo e voluntário, insônia (despertar precoce 2-3h), hiporexia sem perda de peso significativa. Ideação passiva de morte ("estaria melhor com ela") sem plano ou intenção — vinculado aos filhos. Apresenta comorbidades clínicas relevantes (DM2, HA, cardiopatia isquêmica pós-IAM).

**O (Objetivo):** Aspecto cuidado, levemente descuidado. PA 144x88mmHg (atenção — em uso de Enalapril). FC 72bpm. Peso 78kg. Humor intensamente hipoprósico. Afeto triste, choro fácil. Sem agitação. Cognição preservada. Sem sinais de demência.

**A (Avaliação):** Luto complicado/prolongado (Z63.4) com desenvolvimento de episódio depressivo leve (F32.0) e insônia primária (F51.0). Alto risco de isolamento social e deterioração de condições clínicas. Ideação passiva de morte — monitoramento estreito necessário. PA elevada em uso de anti-hipertensivo — comunicar cardiologista.

**P (Plano):** Aguardar evolução do luto antes de medicar — realizar próxima consulta em 10 semanas para reavaliar. Indicar grupo de apoio a viúvos ou psicoterapia individual focada em luto. Comunicar cardiologista sobre PA. Contato com filhos para suporte — autorizado pelo paciente. Solicitado TSH, glicemia, hemograma. Retorno em 10 semanas.`,
      whatsapp_message: `Roberto, obrigado por ter vindo hoje. Sei o quanto foi difícil dar esse passo.

O que você está passando é muito pesado, e faz sentido sentir como está se sentindo. Vamos trabalhar juntos.

📋 Por enquanto, vou acompanhar antes de iniciar medicação — na próxima consulta decidimos juntos.
🩸 Faça os exames solicitados.
❤️ Converse com seus filhos — você autorizou e seria bom ter esse apoio.
📞 Se os pensamentos de "estar com ela" ficarem mais intensos, me ligue ou vá ao pronto-socorro.

Retorno em 10 semanas. Não está sozinho nisto.`,
    },

    {
      patient_id: robertoId, user_id: userId,
      chief_complaint: 'Retorno — sem melhora, iniciando medicação',
      created_at: '2026-01-10T09:30:00Z',
      transcription: `Médico: Roberto, como foi esse tempo?
Paciente: Igual, doutor. Talvez pior. Os filhos querem que eu venha morar com um deles, mas não quero deixar a casa. A casa é dela também.
Médico: Você foi ao grupo de apoio?
Paciente: Fui uma vez. Não gostei. São pessoas mais jovens, não me senti bem.
Médico: Entendo. E os pensamentos de querer estar com ela?
Paciente: Ainda aparecem, mas sei que não farei nada. Fica difícil nos aniversários dela, nos finais de semana.
Médico: Roberto, preciso iniciar uma medicação. Esperei para ver se o luto evoluiria naturalmente, mas o quadro não está melhorando.`,
      soap_note: `**S (Subjetivo):** Retorno após 74 dias. Sem melhora espontânea do quadro depressivo. Mantém isolamento social (saiu de casa menos de 5x no período). Tentativa de grupo de apoio sem aderência. Filhos preocupados. Ideação passiva de morte mantida — sem intensificação. Insônia terminal mantida. Hiporexia com perda de 2kg. Exames: TSH 2,4 (normal), hemograma normal, glicemia jejum 128 (elevada — comunicar endócrino).

**O (Objetivo):** Aspecto descuidado mais evidente. PA 138x86mmHg. Peso 76kg (-2kg em 74 dias). Humor intensamente hipoprósico. Choro durante a consulta ao mencionar a esposa. Sem agitação. Marcha e equilíbrio normais.

**A (Avaliação):** Luto complicado evoluindo para episódio depressivo consolidado. Perda de peso e piora do isolamento indicam necessidade de intervenção farmacológica. Glicemia elevada — comunicar endócrino. Mirtazapina escolhida: ação sedativa (ajuda sono), estimula apetite, mínima interação com Enalapril/Metformina.

**P (Plano):** Iniciado Mirtazapina 30mg à noite. Comunicar endócrino sobre glicemia (128 em uso de Metformina). Incentivar atividade ao ar livre mínima (5-10min de caminhada). Combinar com filhos para visitas mais frequentes. Retorno em 8 semanas.`,
      whatsapp_message: `Roberto, hoje foi importante.

💊 Iniciamos Mirtazapina 30mg — tome à noite antes de dormir. Vai ajudar no sono e no apetite. Efeito no humor leva 2-4 semanas.
⚠️ Avise seu endócrino sobre a glicemia — e tente não pular refeições.
🚶 Tente sair de casa pelo menos 10 minutos por dia, mesmo que só para o corredor do prédio. Luz solar e movimento ajudam.
❤️ Deixei seus filhos cientes de que precisam de visitas mais frequentes.

Retorno em 8 semanas. Estou aqui. 💙`,
    },

    {
      patient_id: robertoId, user_id: userId,
      chief_complaint: 'Retorno — melhora do sono e apetite, humor ainda deprimido',
      created_at: '2026-03-28T09:00:00Z',
      transcription: `Médico: Roberto, como está?
Paciente: O sono melhorou muito, doutor. Consigo dormir umas 7 horas. O apetite voltou um pouco. Mas ainda me sinto triste. Sinto falta dela todo dia.
Médico: É esperado. O luto não some com medicação — mas você está conseguindo funcionar melhor?
Paciente: Um pouco. Fui pescar com meu filho mais novo no mês passado. Primeira vez desde que ela foi. Foi bom... e doeu ao mesmo tempo.
Médico: Isso é exatamente o luto saudável em movimento. O fato de ter ido já é muito.`,
      soap_note: `**S (Subjetivo):** Retorno após 77 dias. Melhora significativa do sono (6-7h, reparador) e apetite. Retomou uma atividade prazerosa (pesca com filho). Tristeza mantida — compatível com processo de luto ainda em andamento, mas funcionalmente melhorada. Ideação passiva de morte ainda ocasional, sem intensidade. Filhos relatam melhora perceptível.

**O (Objetivo):** Aspecto mais cuidado. PA 132x82mmHg. Peso 77kg (+1kg). Humor subdeprimido, mas afeto mais responsivo. Sem choro espontâneo durante a consulta. Glicemia controle 112 mg/dL (melhora).

**A (Avaliação):** Resposta parcial-positiva à Mirtazapina 30mg — melhora do sono, apetite e funcionamento. Humor deprimido residual compatível com luto complicado em resolução parcial. Considerar introdução gradual de atividades sociais e físicas.

**P (Plano):** Manter Mirtazapina 30mg. Estimular saídas com filho (pesca, caminhadas). Propor terapia individual de luto (modalidade integrativa ou TCC para luto). Retorno em 3 meses. Comunicar endócrino sobre melhora da glicemia.`,
      whatsapp_message: `Roberto, ir pescar com seu filho foi um passo enorme 🎣

✅ Continua com Mirtazapina 30mg à noite — mantendo
😴 Fico muito feliz com a melhora do sono
🌿 Tente combinar mais saídas com seus filhos — atividades simples, sem pressão

A tristeza ainda vai aparecer — e está tudo bem. O luto leva tempo. O importante é que você está caminhando.

Retorno em 3 meses. Conte com a gente! 💙`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function useSeedPatients(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    seedIfEmpty(userId);
  }, [userId]);
}

async function seedIfEmpty(userId: string) {
  // Check patient count
  const { count: patientCount } = await supabase
    .from('patients')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  let patientIds: string[] = [];

  if (patientCount === 0) {
    // Insert patients and capture IDs
    const rows = SEED_PATIENTS.map(p => ({
      ...p,
      user_id: userId,
      diagnoses: p.diagnoses as any,
      medications: p.medications as any,
    }));

    const { data: inserted } = await supabase
      .from('patients')
      .insert(rows)
      .select('id, name');

    if (!inserted) return;

    // Match IDs to the persona order
    patientIds = SEED_PATIENTS.map(sp =>
      inserted.find(r => r.name === sp.name)?.id ?? ''
    ).filter(Boolean);
  } else {
    // Patients already exist — fetch IDs in persona order
    const { data: existing } = await supabase
      .from('patients')
      .select('id, name')
      .eq('user_id', userId);

    if (!existing) return;
    patientIds = SEED_PATIENTS.map(sp =>
      existing.find(r => r.name === sp.name)?.id ?? ''
    ).filter(Boolean);
  }

  if (patientIds.length < 5) return;

  // Check if consultations already exist for these patients
  const { count: consultCount } = await supabase
    .from('consultations')
    .select('*', { count: 'exact', head: true })
    .in('patient_id', patientIds);

  if (consultCount !== 0) return;

  // Insert all consultations
  const consultations = buildConsultations(patientIds, userId);
  await supabase.from('consultations').insert(consultations);
}
