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

export const plans = {
  101: [{ carrier: 'Particular', isPrivate: true }, { carrier: 'PLANO SINTÉTICO A', card: '0000000000000101', isPrivate: false }],
  102: [{ carrier: 'Particular', isPrivate: true }],
  105: [{ carrier: 'Particular', isPrivate: true }, { carrier: 'PLANO SINTÉTICO B', card: '', isPrivate: false }],
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
  // Cancelled and no-show.
  appt({ pcod: 102, user: 3, date: '2026-03-03', startMinutes: 15 * 60, estado: 'C' }),
  appt({ pcod: 102, user: 3, date: '2026-04-07', startMinutes: 15 * 60, estado: 'F' }),
  // Future block for doctor 3 and a past one (ignored).
  appt({ user: 3, date: '2026-09-15', startMinutes: 13 * 60, duration: 240, slotType: 'B' }),
  appt({ user: 3, date: '2025-09-15', startMinutes: 13 * 60, duration: 240, slotType: 'B' }),
];
