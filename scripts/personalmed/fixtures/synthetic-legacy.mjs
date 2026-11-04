// Invented legacy rows that mimic the decoded PersonalMed tables. No real
// person, document or phone number: names say "SINTÉTICA", CPFs are built
// from invented digits and phones use the reserved-looking 3000/9000 ranges.
//
// Cases requested by Codex (coordination/mensagens/2026-11-03-2148):
// person with two doctors, family sharing a phone, number without DDD,
// pre-registration without patient, agenda overlap. Plus: CPF typo, plan
// accommodation in the e-mail field, generic CEP, DST-era appointment,
// future schedule block, past appointment without status.

export function makeCpf(base9) {
  const digit = (s) => {
    let sum = 0;
    for (let i = 0; i < s.length; i += 1) sum += Number(s[i]) * (s.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = digit(base9);
  return `${base9}${d1}${digit(`${base9}${d1}`)}`;
}
const fmt = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
const typo = (c) => `${c.slice(0, 10)}${(Number(c[10]) + 1) % 10}`;

export const EXPORT_DATE = '2026-08-24';

const person = (over) => ({
  PCod: 0, Name: '', BirthDate: null, Sex: '', Phone: '', Cellular: '', DDDCellular: '', FAX: '', ID: '', EMail: '',
  Address: '', District: '', City: '', Zip: '', State: '', Mother: '', HomeBorn: '', Occupation: '', ...over,
});

export const persons = [
  // 1. One person, charts with two doctors (3 and 5).
  person({ PCod: 101, Name: 'PACIENTE SINTÉTICA UM', BirthDate: '1985-04-12', Sex: 'F', Phone: '3000-0101', FAX: fmt(makeCpf('100000001')), Address: 'RUA FICTÍCIA, 100', District: 'CENTRO', City: 'CURITIBA', Zip: '80020-100', State: 'PR', Mother: 'MÃE SINTÉTICA UM', HomeBorn: 'CURITIBA', EMail: 'acomodação apto' }),
  // 2–3. Family: two people with the same mobile number, no DDD.
  person({ PCod: 102, Name: 'PACIENTE SINTÉTICA DOIS', BirthDate: '1990-01-30', Sex: 'F', Phone: '99000-0202', FAX: makeCpf('100000002'), Address: 'RUA INVENTADA, 20', District: 'BATEL', City: 'CTBA', Zip: '80420090', State: '' }),
  person({ PCod: 103, Name: 'FILHA SINTÉTICA DOIS', BirthDate: '2012-06-01', Sex: 'F', Phone: '99000-0202', Address: 'RUA INVENTADA, 20', District: 'BATEL', City: 'CURITIBA', Zip: '80420090', State: 'PR', Mother: 'PACIENTE SINTÉTICA DOIS' }),
  // 4. Lives outside the 41 area; old 8-digit mobile; no DDD can be assumed.
  person({ PCod: 104, Name: 'PACIENTE SINTÉTICA QUATRO', BirthDate: '1970-11-05', Sex: 'F', Phone: '9000-0404', Address: 'RUA DE TESTE, 4', District: 'CENTRO', City: 'PONTA GROSSA', Zip: '84010-000', State: 'PR' }),
  // 5. CPF typed with a wrong check digit, sex missing, generic CEP, plan accommodation in e-mail.
  person({ PCod: 105, Name: 'PACIENTE SINTÉTICA CINCO', BirthDate: '1899-12-30', Sex: '', Phone: '(41) 3000-0505 / 99000-0505', FAX: fmt(typo(makeCpf('100000005'))), EMail: 'amb enf', Address: 'AVENIDA EXEMPLO', City: 'CURITIBA', Zip: '80000-000' }),
];

export const charts = [
  { pcod: 101, user: 3, firstVisit: '2015-03-02', lastVisit: '2026-07-10', hasConsultations: true },
  { pcod: 101, user: 5, firstVisit: '2021-08-16', lastVisit: '2026-05-04', hasConsultations: true },
  { pcod: 102, user: 3, firstVisit: '2019-02-11', lastVisit: '2026-06-01', hasConsultations: true },
  { pcod: 103, user: 3, firstVisit: '2025-02-03', lastVisit: '2025-02-03', hasConsultations: false },
  { pcod: 104, user: 9, firstVisit: '2010-05-20', lastVisit: '2018-12-10', hasConsultations: true },
  { pcod: 105, user: 5, firstVisit: '1899-12-30', lastVisit: '2024-09-09', hasConsultations: true },
];

// Clini_05 + Carrier. "Particular" is private pay, not a card.
export const plans = {
  101: [
    { carrierCod: 1, carrier: 'Particular', isPrivate: true },
    { carrierCod: 10, carrier: 'PLANO SINTÉTICO A', card: '0000000000000101', isPrivate: false, ownerName: 'PACIENTE SINTÉTICA UM', expiration: '2027-06-30' },
    // Old card of another holder, expired before the export.
    { carrierCod: 11, carrier: 'PLANO SINTÉTICO C', card: 'C 0101', isPrivate: false, ownerName: 'TITULAR SINTÉTICO', expiration: '2020-01-31' },
  ],
  102: [{ carrierCod: 1, carrier: 'Particular', isPrivate: true }],
  105: [
    { carrierCod: 1, carrier: 'Particular', isPrivate: true },
    // Insurer no longer active at the clinic, no card number, Delphi zero date.
    { carrierCod: 12, carrier: 'PLANO SINTÉTICO B', card: '', isPrivate: false, disabled: true, expiration: '1899-12-30' },
    { carrierCod: 12, carrier: 'PLANO SINTÉTICO B', card: '', isPrivate: false, disabled: true },
  ],
};

/** Activity flags: the whole universe is staged; the first reception cohort is decided later (D12). */
export const cohortFlags = {
  101: { active: true, futureAppointment: true },
  102: { active: true, futureAppointment: true },
  103: { active: true },
  104: {},
  105: {},
};

/** Clinical content per chart `${PCod}|${UserNumber}` (invented text). */
export const clinical = {
  '101|3': {
    encounters: [
      {
        day: '2026-07-10',
        evolutions: [{ text: 'Paciente sintética refere bem-estar.', weight: 62.5, height: 165, pressure: '110/70' }],
        documents: [{ type: 1, text: 'Uso interno\n- PRODUTO A 10mg ____ 1 caixa\nTome 1 cp ao dia.' }],
        cids: [{ code: 'Z01.4', description: 'Exame ginecológico' }, { code: 'N95.9', description: 'Transtorno NE da menopausa' }],
        prenatal: [],
        appointmentKey: { user: 3, date: '2026-07-10', start: 480 },
      },
      { day: '2024-03-10', evolutions: [{ text: 'Retorno sintético.', weight: 10060 }], documents: [], cids: [{ code: 'B37.9', description: 'Candidíase NE' }], prenatal: [] },
    ],
    historyText: 'Antecedentes sintéticos: G1P1.\n10/03/2024 Retorno com exames normais.\n15/05/2025 Paciente sintética sem queixas.\n15/05/2025 Acrescentado no mesmo dia.',
    pages: [
      { title: 'QP/HDA', kind: 'qp_hda', text: 'Queixa sintética de cólica.' },
      { title: 'Antecedentes', kind: 'history', text: 'Antecedente sintético sem relevância.' },
    ],
    pregnancies: [],
    firstVisit: '2015-03-02',
    lastVisit: '2026-07-10',
  },
  '101|5': { encounters: [], historyText: 'Texto corrido sintético sem datas.', pages: [], pregnancies: [], firstVisit: '2021-08-16', lastVisit: '2026-05-04' },
  '102|3': {
    encounters: [{ day: '2026-06-01', evolutions: [], documents: [], cids: [{ code: 'Z34.0', description: 'Supervisão de primeira gravidez normal' }], prenatal: [{ ig: 20, weight: 64, pressure: '110/70', au: 20, bcf: '140', mf: 1, edema: 0 }] }],
    historyText: '',
    pages: [],
    pregnancies: [
      { number: 2, dum: '2026-01-15', dpp: '2026-10-22', dppSource: 'DUM' },
      { number: 1, dum: '2019-01-01', dpp: '2019-10-08', dppSource: 'USG' },
    ],
    firstVisit: '2019-02-11',
    lastVisit: '2026-06-01',
  },
};

const appt = (over) => ({ user: 3, date: EXPORT_DATE, startMinutes: 9 * 60, duration: 20, slotType: 'C', estado: '-', pcod: null, preCadastro: null, typeLabel: 'CONS', ...over });

export const agenda = [
  appt({ pcod: 101, user: 3, date: '2026-07-10', startMinutes: 8 * 60, estado: 'T' }),
  // Past attended visit during daylight saving time (UTC-2 in December 2018).
  appt({ pcod: 104, user: 9, date: '2018-12-10', startMinutes: 9 * 60, duration: 15, estado: 'T' }),
  // Future visits; two of them overlap for doctor 3.
  appt({ pcod: 102, user: 3, date: '2026-09-01', startMinutes: 9 * 60, duration: 20, estado: '-' }),
  appt({ pcod: 101, user: 3, date: '2026-09-01', startMinutes: 9 * 60 + 10, duration: 20, estado: '-' }),
  appt({ pcod: 101, user: 5, date: '2026-09-02', startMinutes: 14 * 60, estado: '-', typeLabel: 'RET' }),
  // Future pre-registration: no patient yet.
  appt({ user: 5, date: '2026-09-03', startMinutes: 10 * 60, estado: '-', preCadastro: { name: 'NOVA PACIENTE SINTÉTICA', phone: '(41) 99000-0909' } }),
  // Past appointment without status (not imported by default, D3).
  appt({ pcod: 105, user: 5, date: '2024-09-09', startMinutes: 11 * 60, estado: '' }),
  // Appointment with a doctor who has no chart for this person (D14).
  appt({ pcod: 104, user: 3, date: '2025-03-12', startMinutes: 16 * 60, estado: 'T' }),
  // Cancelled and no-show.
  appt({ pcod: 102, user: 3, date: '2026-03-03', startMinutes: 15 * 60, estado: 'C' }),
  appt({ pcod: 102, user: 3, date: '2026-04-07', startMinutes: 15 * 60, estado: 'F' }),
  // Future block for doctor 3 and a past one (ignored).
  appt({ user: 3, date: '2026-09-15', startMinutes: 13 * 60, duration: 240, slotType: 'B' }),
  appt({ user: 3, date: '2025-09-15', startMinutes: 13 * 60, duration: 240, slotType: 'B' }),
  // Short block P (D9: never booked), future: becomes a schedule block.
  appt({ user: 5, date: '2026-09-10', startMinutes: 7 * 60, duration: 15, slotType: 'P' }),
  // Empty past slot: no patient and no pre-registered name.
  appt({ user: 3, date: '2025-05-05', startMinutes: 10 * 60, estado: 'C' }),
];

// Document templates (Us05/Gintxt/Pedtxt): invented texts that exercise the
// rules of buildTemplate. Drug names are generic; nothing comes from the export.
export const USAGE_SINCE = '2025-01-01';
const tpl = (over) => ({ table: 'Us05', modelNumber: 0, user: null, modelType: 1, name: '', text: '', rtfTable: false, ...over });
export const templates = [
  // Clinic-wide prescription with route heading, two items and the date footer.
  tpl({
    modelNumber: 1,
    name: 'ITU SINTETICA',
    text: '@nome\n\nUso oral\n- Nitrofurantoína 100 mg ______ 1 caixa\nTomar 1 cápsula de 6 em 6 horas por 5 dias.\n- Fenazopiridina 200 mg ______ 6 comprimidos\nTomar 1 comprimido de 8 em 8 horas se ardor.\n\nCuritiba, @extenso',
  }),
  // A doctor's own template with an unsupported merge field.
  tpl({ modelNumber: 2, user: 5, name: 'Orientação sintética', text: '@nome\n- Medicamento sintético A ______ 1 frasco\nAplicar à noite.\nTipo sanguíneo: @sangue' }),
  // Prescription written as free text: nothing to turn into items.
  tpl({ modelNumber: 3, name: 'Texto livre sintético', text: '@nome\nManter a medicação de uso contínuo e retornar em 30 dias.' }),
  // Controlled substance (D8: phase 2).
  tpl({ modelNumber: 4, name: 'Controlado sintético', text: '- Clonazepam 2 mg ______ 1 caixa\nTomar 1 comprimido à noite.' }),
  // Sixteen items: over the Cortex limit of 15.
  tpl({ modelNumber: 5, name: 'Lista longa sintética', text: Array.from({ length: 16 }, (_, i) => `- Item sintético ${i + 1} ______ 1 unidade`).join('\n') }),
  // Text and exam-request templates: kinds Cortex does not take yet.
  tpl({ modelNumber: 6, modelType: 2, name: 'Atestado sintético', text: 'Atesto que @nome esteve em consulta nesta data.\n\nCuritiba, @extenso' }),
  tpl({ table: 'Pedtxt', modelNumber: 1, modelType: 3, name: 'Exames sintéticos', text: '@nome\nHemograma completo\nGlicemia de jejum' }),
  // Empty template and a name longer than 120 characters with an RTF table.
  tpl({ modelNumber: 7, name: 'Vazio sintético', text: '   ' }),
  tpl({ modelNumber: 8, name: `Nome sintético ${'muito '.repeat(25)}longo`, rtfTable: true, text: '- Medicamento sintético B ______ 1 tubo\nAplicar 2 vezes ao dia.' }),
];

// Issued documents used only to count template usage (counts leave, text does not).
export const issuedDocuments = [
  { user: 3, date: '2026-03-10', text: 'PACIENTE SINTÉTICA\nUso oral\n- Nitrofurantoína 100 mg ______ 1 caixa\nTomar 1 cápsula de 6 em 6 horas por 5 dias.\n- Fenazopiridina 200 mg ______ 6 comprimidos\nTomar 1 comprimido de 8 em 8 horas se ardor.\nCuritiba, 10 de março de 2026' },
  // The same clinic template issued by another doctor.
  { user: 5, date: '2026-05-02', text: 'OUTRA PACIENTE SINTÉTICA\nUso oral\n- Nitrofurantoína 100 mg ______ 1 caixa\nTomar 1 cápsula de 6 em 6 horas por 5 dias.\n- Fenazopiridina 200 mg ______ 6 comprimidos\nTomar 1 comprimido de 8 em 8 horas se ardor.\nCuritiba, 2 de maio de 2026' },
  // Before the usage window: not counted.
  { user: 3, date: '2024-12-30', text: 'PACIENTE SINTÉTICA\n- Nitrofurantoína 100 mg ______ 1 caixa\nTomar 1 cápsula de 6 em 6 horas por 5 dias.\n- Fenazopiridina 200 mg ______ 6 comprimidos\nTomar 1 comprimido de 8 em 8 horas se ardor.' },
  { user: 5, date: '2026-06-01', text: 'PACIENTE SINTÉTICA\n- Medicamento sintético A ______ 1 frasco\nAplicar à noite.\nTipo sanguíneo: O+' },
  // Edited quantity: one fixed line differs, so the template is not counted.
  { user: 3, date: '2026-07-01', text: 'PACIENTE SINTÉTICA\n- Medicamento sintético A ______ 2 frascos\nAplicar à noite.\nTipo sanguíneo: A+' },
];

// "Atenção" field (Clini_01.Attention): invented texts, one per person.
export const alerts = [
  // One doctor; clinical and administrative content in the same note.
  { pcod: 102, text: 'Alérgica a dipirona. Ligar antes para confirmar o horário.' },
  // Two doctors (3 and 5): who receives it depends on D20.
  { pcod: 101, text: 'Gestante, DUM informada na última consulta.' },
  // Mentions death: flagged for the doctor, never sent to the reception directly.
  { pcod: 104, text: 'Paciente faleceu em 2019, segundo a família.' },
  // No category matched.
  { pcod: 105, text: 'Prefere atendimento à tarde.' },
  // Empty or punctuation-only text: no alert.
  { pcod: 103, text: '  -- . ' },
  // Person without any chart.
  { pcod: 199, text: 'Cadastro sintético sem prontuário.' },
];
