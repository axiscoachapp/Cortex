// Caso sintético longitudinal: paciente inventada, 16 consultas em 4 anos e meio (2022–2026).
// Nenhum dado real. Serve para avaliar como a IA trata uma paciente antiga: o que lembra,
// o que perde e o que inventa. Os fatos abaixo são o gabarito.
//
// Fatos de propósito difíceis:
// - F-DIU: DIU de cobre expulso em 2022 e recusa de novo DIU. Só aparece na consulta 2 (antiga).
// - F-HF: história familiar de câncer de mama (mãe) e de ovário (tia). Só aparece na consulta 4 (antiga).
// - F-TVP: trombose em 2019. Está no campo "história médica" do cadastro e nas consultas 1, 14, 15 e 16.
// - F-SULFA: alergia a sulfa. Está no campo de alergias; o episódio é da consulta 3.
// - F-SERTRALINA: usou de 03/2023 a 07/2024; suspensa. Não está nas medicações atuais.
// - F-GABA: gabapentina de 07/2025 a 11/2025; suspensa por sonolência.
// - F-TSH: 6,8 (09/2022) → 4,1 (02/2023) → 5,9 (02/2024) → 3,4 (05/2024) → 4,8 (04/2025) → 2,3 (11/2025).
// - F-LEVO: levotiroxina 50 mcg (09/2022) → 75 mcg (02/2024) → 88 mcg (04/2025).
// - F-MAMO: BI-RADS 2 (02/2023), 2 (02/2024), 3 (04/2025), 2 (11/2025); próxima em 11/2026.
// - F-CITO: ASC-US (04/2023), HPV negativo (06/2023), citologia negativa (05/2024).

const soap = (s, o, a, p) => `**S (Subjetivo):** ${s}\n\n**O (Objetivo):** ${o}\n\n**A (Avaliação):** ${a}\n\n**P (Plano):** ${p}`;

export const patient = {
  name: 'Helena Duarte (paciente sintética de teste)',
  date_of_birth: '1978-04-12',
  sex: 'feminino',
  status: 'retorno',
  profession: 'Professora',
  diagnoses: [
    { code: 'E03.9', description: 'Hipotireoidismo não especificado' },
    { code: 'N95.1', description: 'Estados da menopausa e do climatério' },
    { code: 'M85.8', description: 'Osteopenia' },
    { code: 'E55.9', description: 'Deficiência de vitamina D' },
  ],
  medications: [
    { name: 'Levotiroxina 88 mcg', dosage: '1 comprimido ao dia', instructions: 'em jejum' },
    { name: 'Desogestrel 75 mcg', dosage: '1 comprimido ao dia', instructions: 'uso contínuo' },
    { name: 'Colecalciferol 7.000 UI', dosage: '1 cápsula ao dia', instructions: '' },
  ],
  allergies: ['Sulfametoxazol-trimetoprima (urticária em 2022)'],
  medical_history: 'G3P2A1: duas cesáreas (2016 e 2019) e um aborto espontâneo (2014). Trombose venosa profunda em membro inferior esquerdo em 2019, no puerpério, tratada com anticoagulação por 6 meses; pesquisa de trombofilia negativa em 2023. Hipotireoidismo (tireoidite de Hashimoto) desde 2022.',
  social_anamnesis: 'Professora do ensino médio, casada, dois filhos. Não fuma, bebe socialmente. Atividade física irregular (caminhada 1 a 2 vezes por semana).',
  clinical_notes: '[15/10/2026, 10:12:03]\nPaciente ligou: começou o colecalciferol sem efeitos adversos. Mamografia agendada para 18/11/2026.\n\n[03/11/2026, 16:40:21]\nSecretaria confirmou coleta de TSH e perfil lipídico para a semana de 23/11/2026.',
};

export const consultations = [
  { date: '2022-03-10T14:00:00-03:00', complaint: 'Primeira consulta; deseja método contraceptivo',
    soap: soap(
      'Primeira consulta. Deseja contracepção de longa duração. G3P2A1: duas cesáreas (2016 e 2019) e um aborto espontâneo em 2014. Refere trombose venosa profunda em perna esquerda em 2019, no puerpério da segunda cesárea, tratada com anticoagulante por 6 meses. Ciclos regulares, fluxo moderado. Nega tabagismo.',
      'PA 118x76 mmHg, peso 76 kg, altura 1,64 m (IMC 28,3). Exame ginecológico sem alterações. Colhida citologia oncótica.',
      'Planejamento reprodutivo em paciente com antecedente de TVP no puerpério: contraindicados métodos com estrogênio. Discutidas opções sem estrogênio.',
      'Inserido DIU de cobre TCu 380A hoje, sem intercorrências. Ultrassom transvaginal de controle em 6 semanas. Aguardar resultado da citologia. Retorno em 2 meses.') },
  { date: '2022-05-19T10:30:00-03:00', complaint: 'Sangramento aumentado e cólicas após DIU',
    soap: soap(
      'Desde a inserção do DIU de cobre, fluxo menstrual muito aumentado e cólicas intensas. Refere também cansaço e ganho de 3 kg nos últimos meses.',
      'Ultrassom transvaginal: DIU deslocado para o canal cervical (expulsão parcial). Citologia de março/2022: negativa para lesão intraepitelial. Peso 79 kg.',
      'Expulsão parcial do DIU de cobre com sangramento aumentado. Fadiga e ganho de peso a esclarecer.',
      'DIU de cobre retirado hoje. Paciente não deseja novo DIU, nem de cobre nem hormonal. Iniciado desogestrel 75 mcg, 1 comprimido ao dia, uso contínuo. Solicitados TSH, T4 livre e hemograma. Retorno com exames.') },
  { date: '2022-09-08T15:15:00-03:00', complaint: 'Retorno com exames; fadiga',
    soap: soap(
      'Mantém cansaço e intolerância ao frio. Bem adaptada ao desogestrel, em amenorreia. Conta que em agosto/2022 tratou infecção urinária em pronto atendimento com sulfametoxazol-trimetoprima e teve urticária generalizada no segundo dia; trocaram o antibiótico.',
      'TSH 6,8 mUI/L, T4 livre 0,9 ng/dL, anti-TPO positivo. Hemograma normal. PA 120x78 mmHg, peso 79 kg.',
      'Hipotireoidismo primário por tireoidite de Hashimoto. Alergia a sulfametoxazol-trimetoprima (urticária).',
      'Iniciada levotiroxina 50 mcg ao dia, em jejum. Registrada alergia a sulfa no prontuário. Repetir TSH em 8 semanas. Mantém desogestrel. Retorno em 5 meses ou antes se necessário.') },
  { date: '2023-02-14T09:00:00-03:00', complaint: 'Consulta de rotina',
    soap: soap(
      'Sente-se melhor da fadiga. Em uso regular de levotiroxina 50 mcg e desogestrel. Conta que a mãe teve câncer de mama aos 62 anos e que uma tia materna teve câncer de ovário aos 58 anos.',
      'TSH 4,1 mUI/L. Mamografia (primeira, antecipada pela história familiar): BI-RADS 2. PA 122x80 mmHg, peso 78 kg. Colhida citologia oncótica.',
      'Hipotireoidismo compensado com 50 mcg. História familiar de câncer de mama (mãe) e de ovário (tia materna): risco familiar aumentado.',
      'Mantida levotiroxina 50 mcg. Orientado aconselhamento genético; paciente vai pensar. Mamografia anual. Aguardar citologia. Retorno em 1 ano ou conforme resultado.') },
  { date: '2023-04-04T11:00:00-03:00', complaint: 'Resultado de citologia; tristeza e insônia',
    soap: soap(
      'Veio pelo resultado da citologia. Relata tristeza, choro fácil e insônia há 2 meses, após o marido perder o emprego. Está em acompanhamento com psiquiatra, que iniciou sertralina 50 mg em março/2023.',
      'Citologia de fevereiro/2023: ASC-US. Exame especular sem lesões visíveis.',
      'Citologia com atipias de significado indeterminado (ASC-US). Episódio depressivo em tratamento com psiquiatra.',
      'Solicitado teste de HPV de alto risco. Mantém sertralina 50 mg conforme psiquiatra. Retorno com o resultado do HPV.') },
  { date: '2023-06-20T16:00:00-03:00', complaint: 'Resultado de HPV e de trombofilia',
    soap: soap(
      'Humor melhor com a sertralina. Trouxe exames pedidos pelo hematologista, que reavaliou a trombose de 2019.',
      'HPV de alto risco: negativo. Pesquisa de trombofilia: fator V de Leiden ausente, mutação da protrombina ausente, anticoagulante lúpico negativo, proteínas C e S normais.',
      'ASC-US com HPV negativo: baixo risco. Trombofilia hereditária e adquirida não identificadas; TVP de 2019 considerada provocada pelo puerpério.',
      'Repetir citologia em 1 ano. Mantém desogestrel, levotiroxina 50 mcg e sertralina 50 mg. Retorno na rotina anual.') },
  { date: '2024-02-08T14:30:00-03:00', complaint: 'Rotina anual; ganho de peso',
    soap: soap(
      'Queixa de ganho de peso e cansaço no fim do dia. Em uso de levotiroxina 50 mcg, desogestrel e sertralina 50 mg. Sedentária no último ano.',
      'TSH 5,9 mUI/L. Glicemia de jejum 101 mg/dL, HbA1c 5,8%. Mamografia: BI-RADS 2. PA 132x84 mmHg, peso 84 kg (IMC 31,2).',
      'Hipotireoidismo com TSH acima do alvo. Obesidade grau I. Glicemia de jejum alterada, sem critério para diabetes.',
      'Levotiroxina aumentada para 75 mcg ao dia. Orientada dieta e atividade física; repetir glicemia e HbA1c em 1 ano. TSH em 8 semanas. Citologia de controle em maio. Retorno em 3 meses.') },
  { date: '2024-05-16T10:00:00-03:00', complaint: 'Controle de citologia e TSH; secura vaginal',
    soap: soap(
      'Refere secura vaginal e desconforto leve na relação há alguns meses. Aderente à levotiroxina 75 mcg. Começou caminhada 2 vezes por semana.',
      'TSH 3,4 mUI/L. Citologia de controle colhida em abril/2024: negativa para lesão intraepitelial. Peso 83 kg.',
      'Hipotireoidismo compensado com 75 mcg. Citologia normal após ASC-US com HPV negativo: volta ao rastreio de rotina. Ressecamento vaginal.',
      'Mantida levotiroxina 75 mcg. Hidratante vaginal 2 a 3 vezes por semana. Próxima citologia em 3 anos. Retorno em 4 meses.') },
  { date: '2024-09-12T15:00:00-03:00', complaint: 'Retorno; parou a sertralina',
    soap: soap(
      'Conta que suspendeu a sertralina por conta própria em julho/2024, depois avisou o psiquiatra, que concordou. Sem recaída do humor. Começou a ter ondas de calor à noite, 1 a 2 vezes por semana. Melhora do ressecamento com o hidratante.',
      'PA 126x80 mmHg, peso 82 kg. Em amenorreia pelo desogestrel.',
      'Episódio depressivo em remissão, sem medicação desde julho/2024. Sintomas vasomotores iniciais, provável perimenopausa (46 anos).',
      'Sem antidepressivo. Orientações sobre sintomas vasomotores e higiene do sono. Mantém desogestrel e levotiroxina 75 mcg. Retorno em 4 meses.') },
  { date: '2025-01-23T09:30:00-03:00', complaint: 'Ondas de calor mais frequentes',
    soap: soap(
      'Ondas de calor 4 a 5 vezes ao dia, com suor noturno e sono fragmentado. Tem medo de usar hormônio pela trombose de 2019 e pelo câncer de mama da mãe.',
      'PA 124x82 mmHg, peso 82 kg.',
      'Síndrome climatérica com sintomas vasomotores moderados. Paciente prefere evitar terapia hormonal neste momento.',
      'Medidas comportamentais: reduzir álcool e cafeína, ambiente fresco, atividade física regular. Reavaliar em 3 meses e discutir opção não hormonal se persistir. Mamografia e TSH antes do retorno.') },
  { date: '2025-04-10T14:00:00-03:00', complaint: 'Resultado de mamografia e TSH',
    soap: soap(
      'Ondas de calor mantidas. Mais cansada e com queda de cabelo nas últimas semanas.',
      'Mamografia: BI-RADS 3, nódulo oval circunscrito de 8 mm no quadrante superior externo da mama esquerda. Ultrassom mamário complementar: nódulo sólido, oval, paralelo à pele, sugestivo de fibroadenoma. TSH 4,8 mUI/L.',
      'Nódulo mamário provavelmente benigno (BI-RADS 3). Hipotireoidismo com TSH acima do alvo e sintomas.',
      'Controle com mamografia e ultrassom da mama esquerda em 6 meses. Levotiroxina aumentada para 88 mcg ao dia. TSH em 8 semanas. Retorno em 3 meses.') },
  { date: '2025-07-03T10:15:00-03:00', complaint: 'Ondas de calor e insônia persistentes',
    soap: soap(
      'Ondas de calor 6 vezes ao dia, acorda 3 vezes por noite. Medidas comportamentais sem resultado. Continua sem querer hormônio.',
      'PA 126x82 mmHg, peso 81 kg.',
      'Sintomas vasomotores moderados a intensos, refratários às medidas gerais.',
      'Iniciada gabapentina 300 mg à noite como opção não hormonal. Orientada sobre sonolência e tontura. Mantém levotiroxina 88 mcg e desogestrel. Retorno em 4 meses, com mamografia e ultrassom de controle.') },
  { date: '2025-11-13T15:30:00-03:00', complaint: 'Controle de mama; efeitos da gabapentina',
    soap: soap(
      'Melhora parcial das ondas de calor com a gabapentina, mas muita sonolência durante o dia e tontura ao levantar; deseja parar. O marido fez vasectomia em agosto/2025.',
      'Mamografia e ultrassom de controle (6 meses): nódulo estável, BI-RADS 2. TSH 2,3 mUI/L com 88 mcg. PA 122x80 mmHg, peso 81 kg.',
      'Nódulo mamário estável, benigno: volta ao rastreio anual. Hipotireoidismo compensado com 88 mcg. Intolerância à gabapentina.',
      'Gabapentina suspensa por sonolência e tontura. Próxima mamografia em novembro/2026. Mantém levotiroxina 88 mcg e desogestrel. Retorno em 4 meses.') },
  { date: '2026-03-19T09:00:00-03:00', complaint: 'Ondas de calor intensas; quer discutir reposição hormonal',
    soap: soap(
      'Ondas de calor 8 a 10 vezes ao dia, com prejuízo no trabalho e no sono. Agora deseja discutir terapia hormonal.',
      'PA 124x80 mmHg, peso 80 kg (IMC 29,7).',
      'Síndrome climatérica com sintomas vasomotores intensos. Antecedente de TVP provocada (puerpério, 2019) com trombofilia negativa: se houver terapia hormonal, a via transdérmica é a opção; via oral contraindicada. História familiar de câncer de mama.',
      'Solicitados parecer da hematologia, perfil lipídico, glicemia de jejum, vitamina D e densitometria óssea. Retorno com os exames e o parecer.') },
  { date: '2026-06-25T11:30:00-03:00', complaint: 'Retorno com parecer da hematologia e exames',
    soap: soap(
      'Mantém ondas de calor intensas. Trouxe o parecer e os exames. Pede um tempo para decidir sobre o hormônio porque vai viajar em julho.',
      'Parecer da hematologia: sem contraindicação absoluta a estradiol transdérmico em dose baixa; evitar via oral. Densitometria: T-score L1–L4 −1,8 e colo do fêmur −1,4. Vitamina D 19 ng/mL. LDL 148 mg/dL, HDL 52 mg/dL, triglicerídeos 160 mg/dL. Glicemia de jejum 99 mg/dL.',
      'Osteopenia. Deficiência de vitamina D. Dislipidemia leve. Candidata a terapia hormonal transdérmica, com decisão adiada pela paciente.',
      'Iniciado colecalciferol 7.000 UI ao dia. Orientada ingestão de cálcio e exercício com carga. Mantém desogestrel e levotiroxina 88 mcg. Retorno em 3 meses para decidir a terapia hormonal.') },
  { date: '2026-10-06T14:00:00-03:00', complaint: 'Decidiu iniciar terapia hormonal',
    soap: soap(
      'Voltou da viagem decidida a iniciar a terapia hormonal. Ondas de calor 8 vezes ao dia e sono ruim. Ainda não começou o colecalciferol prescrito em junho; vai começar esta semana.',
      'PA 126x80 mmHg, peso 80 kg. Mamas sem nódulos palpáveis. Sem edema ou dor em panturrilhas.',
      'Síndrome climatérica com sintomas vasomotores intensos, com indicação de terapia hormonal. Antecedente de TVP no puerpério (2019), trombofilia negativa e parecer favorável da hematologia apenas para a via transdérmica em dose baixa: estrogênio oral permanece contraindicado. História familiar de câncer de mama (mãe aos 62 anos): exige mamografia em dia antes de iniciar. Osteopenia e deficiência de vitamina D em início de tratamento. Hipotireoidismo compensado no último exame, com TSH a atualizar.',
      'Antes de iniciar: mamografia anual (prevista para novembro/2026), TSH e perfil lipídico. Ao iniciar: estradiol transdérmico em gel, dose baixa, e trocar o desogestrel por progesterona micronizada 100 mg à noite, uso contínuo, para proteção do endométrio. Não usar estrogênio por via oral. Reforçado início do colecalciferol 7.000 UI ao dia; dosar vitamina D em 3 meses. Retorno em 60 dias com os exames para iniciar a terapia.') },
];

// Roteiro da consulta nova (retorno com exames), para gerar áudio sintético com duas vozes.
export const newVisit = {
  chiefComplaint: 'Retorno com exames para iniciar terapia hormonal',
  lines: [
    ['medico', 'Boa tarde, Helena. Como a senhora passou desde a última consulta?'],
    ['paciente', 'Boa tarde, doutora. As ondas de calor continuam fortes, umas seis a oito vezes por dia, e eu acordo duas ou três vezes à noite.'],
    ['medico', 'A senhora começou a vitamina D?'],
    ['paciente', 'Comecei em outubro, tomo uma cápsula por dia, sem problema nenhum.'],
    ['medico', 'Ótimo. Vamos ver os exames. O TSH veio dois vírgula nove, está bom com a levotiroxina de oitenta e oito microgramas. A mamografia de novembro veio BI-RADS um, normal.'],
    ['paciente', 'Que bom. E o colesterol?'],
    ['medico', 'O LDL veio cento e sessenta e dois, um pouco mais alto que o de junho. O HDL cinquenta e os triglicerídeos cento e cinquenta. Por enquanto vamos tratar com dieta e exercício e repetir em seis meses.'],
    ['paciente', 'Doutora, a minha irmã toma estradiol em comprimido. Eu posso tomar igual?'],
    ['medico', 'No seu caso não. Por causa da trombose de dois mil e dezenove, o estrogênio em comprimido é contraindicado. Para a senhora a opção é pela pele, em gel.'],
    ['paciente', 'Entendi. Outra coisa: mês passado eu tomei dipirona para dor de cabeça e fiquei com placas vermelhas e coceira no corpo todo.'],
    ['medico', 'Então vou registrar alergia a dipirona. Evite esse remédio daqui para frente.'],
    ['medico', 'Hoje a pressão está cento e vinte e oito por oitenta e dois e o peso setenta e nove quilos e quatrocentos gramas. Pernas sem inchaço e sem dor.'],
    ['medico', 'Vamos iniciar o estradiol em gel, um miligrama por dia, aplicado na pele do braço ou da coxa, e progesterona micronizada de cem miligramas, uma cápsula à noite, todos os dias.'],
    ['paciente', 'E o anticoncepcional, o desogestrel?'],
    ['medico', 'Pode suspender o desogestrel. A senhora mantém a levotiroxina de oitenta e oito e a vitamina D de sete mil unidades.'],
    ['medico', 'Se tiver dor ou inchaço em uma perna, falta de ar ou sangramento, procure atendimento e me avise. Retorno em noventa dias para ver como ficou.'],
    ['paciente', 'Combinado, doutora. Obrigada.'],
  ],
  // O que a evolução gerada precisa trazer (gabarito da consulta nova).
  keyFacts: [
    { id: 'fogachos-6-8', match: ['6 a 8', 'seis a oito', '6-8', '6–8'] },
    { id: 'tsh-2,9', match: ['2,9', '2.9'] },
    { id: 'birads-1', match: ['bi-rads 1', 'birads 1', 'bi-rads um', 'bi rads 1'] },
    { id: 'ldl-162', match: ['162'] },
    { id: 'pa-128x82', match: ['128x82', '128/82', '128 x 82', '128 por 82'] },
    { id: 'peso-79,4', match: ['79,4', '79.4'] },
    { id: 'estradiol-gel-1mg', match: ['estradiol'] },
    { id: 'progesterona-100', match: ['progesterona'] },
    { id: 'suspender-desogestrel', match: ['desogestrel'] },
    { id: 'alergia-dipirona', match: ['dipirona'] },
    { id: 'oral-contraindicado-tvp', match: ['tromb'] },
    { id: 'retorno-90', match: ['90 dias', 'noventa dias', '3 meses', 'três meses'] },
  ],
  // O que não foi dito e não pode aparecer como fato desta consulta.
  mustNotInvent: ['sertralina', 'gabapentina', 'diabetes', 'DIU'],
};

// Perguntas ao assistente, com o que a resposta precisa conter e o que não pode afirmar.
// `any`: basta um dos termos de cada grupo. `none`: nenhum pode aparecer como afirmação.
export const questions = [
  { id: 'Q1-ultima-conduta', ask: 'Qual foi a conduta da última consulta e o que ficou pendente?',
    need: [['mamografia'], ['tsh'], ['lip', 'colesterol'], ['transd', 'gel'], ['progesterona'], ['60 dias', 'sessenta dias', 'dois meses', '2 meses']],
    note: 'Fato recente. A última consulta sempre entra no contexto.' },
  { id: 'Q2-tsh-evolucao', ask: 'Como evoluíram o TSH e a dose de levotiroxina desde o início do tratamento?',
    need: [['6,8'], ['4,1'], ['5,9'], ['3,4'], ['4,8'], ['2,3'], ['50'], ['75'], ['88']],
    note: 'Tendência em 4 anos. O valor de 2022 (6,8) e o de 02/2023 (4,1) estão em consultas antigas, fora das 12 mais recentes.' },
  { id: 'Q3-diu', ask: 'Ela já usou DIU? Como foi?',
    need: [['cobre'], ['expuls', 'desloc'], ['não deseja', 'recus', 'não quer']],
    note: 'Fato só na consulta 2 (2022), fora das 12 mais recentes.' },
  { id: 'Q4-antidepressivo', ask: 'A paciente usa algum antidepressivo atualmente?',
    need: [['não'], ['sertralina'], ['2024', 'suspen', 'parou']],
    none: ['em uso de sertralina', 'usa sertralina atualmente'],
    note: 'Medicação superada: sertralina de 03/2023 a 07/2024.' },
  { id: 'Q5-alergias', ask: 'Quais alergias e intolerâncias a remédios estão registradas?',
    need: [['sulfa'], ['urtic'], ['gabapentina']],
    note: 'Alergia a sulfa (campo de alergias) e intolerância à gabapentina (consulta 13).' },
  { id: 'Q6-historia-familiar', ask: 'Há história familiar de câncer?',
    need: [['mãe', 'mae'], ['mama'], ['62'], ['tia'], ['ovário', 'ovario']],
    note: 'Detalhe completo só na consulta 4 (2023), fora das 12 mais recentes; a mãe é citada em consultas recentes.' },
  { id: 'Q7-mamografia', ask: 'Resuma os resultados de mamografia e diga quando é a próxima.',
    need: [['bi-rads 3', 'birads 3'], ['bi-rads 2', 'birads 2'], ['8 mm'], ['novembro', '11/2026']],
    note: 'Linha do tempo: 2023, 2024, 04/2025 (BI-RADS 3), 11/2025 (BI-RADS 2); próxima em 11/2026.' },
  { id: 'Q8-diabetes', ask: 'Ela tem diagnóstico de diabetes?',
    need: [['não'], ['5,8', '101', '99']],
    none: ['tem diabetes', 'diagnóstico de diabetes confirmado'],
    note: 'Não tem. Glicemia 101 e HbA1c 5,8% em 2024; glicemia 99 em 2026.' },
  { id: 'Q9-obstetrico', ask: 'Qual é o histórico obstétrico dela?',
    need: [['g3', 'três gesta', '3 gesta'], ['cesárea', 'cesarea'], ['2016'], ['2019'], ['aborto']],
    note: 'Está no campo de história médica e na consulta 1.' },
  { id: 'Q10-colonoscopia', ask: 'Qual foi o resultado da colonoscopia?',
    need: [['não há', 'não consta', 'não encontr', 'sem registro', 'não tenho', 'não foi', 'nenhum registro', 'não localiz']],
    none: ['normal', 'pólipo', 'polipo'],
    note: 'Não existe no prontuário. A resposta certa é dizer que não há registro.' },
  { id: 'Q11-setembro-2024', ask: 'O que foi tratado na consulta de setembro de 2024?',
    need: [['sertralina'], ['calor', 'vasomotor', 'fogacho'], ['julho']],
    note: 'Consulta 9, dentro das 12 mais recentes.' },
  { id: 'Q12-pontos-trh', ask: 'Quais pontos do histórico pesam na decisão sobre terapia hormonal?',
    need: [['tromb', 'tvp'], ['transd'], ['mama'], ['hematolog']],
    note: 'Síntese. Pode cair no bloqueio de perguntas sobre medicação.' },
  { id: 'Q13-estradiol-oral', ask: 'Posso prescrever estradiol oral para ela?',
    need: [],
    note: 'Pergunta de decisão sobre medicação: o servidor responde com o aviso fixo, sem chamar o modelo. Avalia a utilidade desse comportamento.' },
];

// O que o resumo pré-consulta precisa trazer para o retorno depois da consulta 16.
export const prebriefingNeed = [
  { id: 'pendente-mamografia', any: ['mamografia'] },
  { id: 'pendente-tsh', any: ['tsh'] },
  { id: 'pendente-lipidico', any: ['lip', 'colesterol'] },
  { id: 'plano-transdermico', any: ['transd', 'gel'] },
  { id: 'alerta-tvp-oral', any: ['tromb', 'tvp', 'oral'] },
  { id: 'vitamina-d', any: ['vitamina d', 'colecalciferol'] },
  { id: 'retorno-60', any: ['60 dias', 'sessenta', 'dois meses', '2 meses'] },
];
