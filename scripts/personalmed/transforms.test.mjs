// Synthetic fixtures only: invented names, numbers and texts.
import { describe, expect, it } from 'vitest';
import {
  alertCategories,
  cleanName,
  cpfValid,
  dateInWords,
  envelope,
  extractPhones,
  findCpf,
  findOverlaps,
  hasHouseNumber,
  historyByDay,
  legacyDate,
  livesInArea41,
  mapAppointmentStatus,
  mapSex,
  mergeFieldsOf,
  normalizeCep,
  normalizeCity,
  normalizeEmail,
  normalizePhone,
  normalizeUf,
  parseTemplateItems,
  templateChunks,
  templateKind,
  templateUsage,
  registrationPhones,
  splitHistory,
  targetId,
  uuidv5,
} from './transforms.mjs';

/** Build a checksum-valid CPF from 9 invented digits. */
function makeCpf(base9) {
  const digit = (s) => {
    let sum = 0;
    for (let i = 0; i < s.length; i += 1) sum += Number(s[i]) * (s.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = digit(base9);
  return `${base9}${d1}${digit(`${base9}${d1}`)}`;
}
const fmtCpf = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;

describe('identifiers', () => {
  it('implements RFC 4122 UUIDv5', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('gives the same target id on every run and different ids per entity', () => {
    const a = targetId('pm-test', 'chart', 'pcod:1|user:3');
    expect(targetId('pm-test', 'chart', 'pcod:1|user:3')).toBe(a);
    expect(targetId('pm-test', 'person', 'pcod:1|user:3')).not.toBe(a);
  });

  it('builds the staging envelope with sorted unique issues and review status', () => {
    const e = envelope({ sourceInstance: 'pm-test', sourceEntity: 'chart', key: { pcod: 1, user: 3 }, doctor: 3, batchId: 'b1', targetTable: 'patients', payload: {}, issues: ['b', 'a', 'b'] });
    expect(e.sourceRecordId).toBe('pcod:1|user:3');
    expect(e.sourceDoctorId).toBe('user:3');
    expect(e.issues).toEqual(['a', 'b']);
    expect(e.mappingStatus).toBe('ready');
    expect(envelope({ sourceInstance: 'x', sourceEntity: 'consultation', key: { pcod: 1 }, batchId: 'b', targetTable: 'consultations', payload: {}, issues: ['history_date_out_of_order'] }).mappingStatus).toBe('requires_review');
  });
});

describe('CPF', () => {
  const cpf = makeCpf('123456789');

  it('accepts valid CPFs and rejects repeated digits', () => {
    expect(cpfValid(cpf)).toBe(true);
    expect(cpfValid('11111111111')).toBe(false);
  });

  it('finds the CPF in the FAX field, formatted or not', () => {
    expect(findCpf({ fax: fmtCpf(cpf) })).toEqual({ value: cpf, source: 'fax', issues: [] });
    expect(findCpf({ fax: cpf }).value).toBe(cpf);
  });

  it('falls back to RG, then e-mail', () => {
    expect(findCpf({ fax: '', rg: cpf }).source).toBe('rg');
    expect(findCpf({ fax: 'AMB ENF', email: cpf }).source).toBe('email');
  });

  it('flags a mistyped CPF and keeps nothing', () => {
    const typo = `${cpf.slice(0, 10)}${(Number(cpf[10]) + 1) % 10}`;
    expect(findCpf({ fax: fmtCpf(typo) })).toEqual({ value: null, source: null, issues: ['cpf_checksum_invalid'] });
  });

  it('does not take a phone-shaped number as CPF even if the checksum passes', () => {
    const mobileLike = makeCpf('419123456');
    expect(findCpf({ fax: `(41) ${mobileLike.slice(2, 7)}-${mobileLike.slice(7)}` }).value).toBeNull();
    expect(findCpf({ fax: mobileLike })).toMatchObject({ value: mobileLike, issues: ['cpf_ambiguous_mobile'] });
    expect(findCpf({ phone: mobileLike }).value).toBeNull();
  });
});

describe('phones', () => {
  it('extracts several numbers from one field', () => {
    expect(extractPhones('3333-4444 / (41) 99999-8888')).toEqual(['3333-4444', '(41) 99999-8888']);
    expect(extractPhones('3333-4444 9999-8888')).toHaveLength(2);
  });

  it('adds DDD 41 only for patients who live in the 41 area', () => {
    expect(normalizePhone('3333-4444', { area41: true })).toEqual({ raw: '3333-4444', normalized: '554133334444', issues: ['phone_ddd_assumed_41'] });
    expect(normalizePhone('99999-8888', { area41: false })).toEqual({ raw: '99999-8888', normalized: null, issues: ['phone_no_ddd_outside_41'] });
  });

  it('adds the ninth digit to old 8-digit mobiles', () => {
    expect(normalizePhone('9999-8888', { area41: true }).normalized).toBe('5541999998888');
    expect(normalizePhone('(41) 9999-8888').issues).toEqual(['phone_ninth_digit_added']);
  });

  it('keeps known DDDs and country codes', () => {
    expect(normalizePhone('(42) 3333-4444').normalized).toBe('554233334444');
    expect(normalizePhone('99999-8888', { ddd: '43' }).normalized).toBe('5543999998888');
    expect(normalizePhone('+55 41 99999-8888').normalized).toBe('5541999998888');
    expect(normalizePhone('041 3333-4444').normalized).toBe('554133334444');
  });

  it('rejects numbers that are not phones', () => {
    expect(normalizePhone('12345').issues).toEqual(['phone_invalid']);
    expect(normalizePhone('(10) 3333-4444').issues).toEqual(['phone_invalid']);
  });

  it('deduplicates the same number and ignores the CPF in FAX', () => {
    const cpf = makeCpf('987654321');
    const list = registrationPhones({ phone: '3333-4444', cellular: '3333-4444', fax: cpf }, { cep: '80420090' });
    expect(list.map((p) => p.normalized)).toEqual(['554133334444']);
    const withFaxPhone = registrationPhones({ phone: '', fax: '3222-1111' }, { city: 'Curitiba' });
    expect(withFaxPhone).toMatchObject([{ normalized: '554132221111', kind: 'fax' }]);
  });

  it('recognizes the 41 area by CEP or city', () => {
    expect(livesInArea41({ cep: '83005-000' })).toBe(true);
    expect(livesInArea41({ city: 'São José dos Pinhais' })).toBe(true);
    expect(livesInArea41({ cep: '84010-000', city: 'Ponta Grossa' })).toBe(false);
  });
});

describe('e-mail field', () => {
  it('keeps valid e-mails only', () => {
    expect(normalizeEmail('Paciente.Teste@Example.com').email).toBe('paciente.teste@example.com');
    expect(normalizeEmail('paciente@').issues).toEqual(['email_invalid']);
  });

  it('moves the plan accommodation out of the e-mail field', () => {
    expect(normalizeEmail('acomodação apto')).toEqual({ email: null, accommodation: { category: 'apartamento', original: 'acomodação apto' }, issues: ['email_field_reused'] });
    expect(normalizeEmail('amb enf').accommodation.category).toBe('enfermaria');
    expect(normalizeEmail('plano flex').accommodation.category).toBe('outro');
  });
});

describe('address', () => {
  it('validates CEP ranges and flags generic CEPs', () => {
    expect(normalizeCep('80.000-000')).toEqual({ cep: '80000000', uf: 'PR', issues: ['cep_generic'] });
    expect(normalizeCep('80420-090')).toEqual({ cep: '80420090', uf: 'PR', issues: [] });
    expect(normalizeCep('80420').issues).toEqual(['cep_old_5_digits']);
    expect(normalizeCep('00000000').issues).toEqual(['cep_out_of_range']);
    expect(normalizeCep('').issues).toEqual(['cep_missing']);
  });

  it('normalizes or infers the UF', () => {
    expect(normalizeUf('pr')).toEqual({ uf: 'PR', issues: [] });
    expect(normalizeUf('Paraná').uf).toBe('PR');
    expect(normalizeUf('', { cepUf: 'PR' })).toEqual({ uf: 'PR', issues: ['uf_inferred_from_cep'] });
    expect(normalizeUf('', { city: 'CTBA' })).toEqual({ uf: 'PR', issues: ['uf_inferred_from_city'] });
    expect(normalizeUf('SP', { cepUf: 'PR' })).toEqual({ uf: 'SP', issues: ['cep_uf_mismatch'] });
  });

  it('unifies the spellings of Curitiba and keeps other cities as typed', () => {
    expect(normalizeCity('CTBA')).toEqual({ city: 'Curitiba', issues: ['city_spelling_normalized'] });
    expect(normalizeCity('CURITIBA')).toEqual({ city: 'Curitiba', issues: [] });
    expect(normalizeCity('  PONTA   GROSSA ')).toEqual({ city: 'PONTA GROSSA', issues: [] });
  });

  it('detects a house number or s/n', () => {
    expect(hasHouseNumber('RUA EXEMPLO, 100')).toBe(true);
    expect(hasHouseNumber('RUA EXEMPLO S/N')).toBe(true);
    expect(hasHouseNumber('RUA EXEMPLO')).toBe(false);
  });
});

describe('person fields', () => {
  it('maps sex without inventing "nao_informado"', () => {
    expect(mapSex('F').sex).toBe('feminino');
    expect(mapSex('m').sex).toBe('masculino');
    expect(mapSex('')).toEqual({ sex: null, issues: ['sex_missing'] });
  });

  it('cleans names and flags annotations', () => {
    expect(cleanName('  PACIENTE   SINTÉTICA ')).toEqual({ name: 'PACIENTE SINTÉTICA', issues: [] });
    expect(cleanName('PACIENTE TESTE 14:30').issues).toEqual(['name_has_annotation']);
    expect(cleanName('AAA').issues).toEqual(['name_invalid']);
  });

  it('turns the Delphi zero date and impossible dates into null', () => {
    expect(legacyDate('1899-12-30')).toEqual({ date: null, issues: ['date_sentinel'] });
    expect(legacyDate('2088-01-01', { max: '2026-08-24' }).issues).toEqual(['date_out_of_range']);
    expect(legacyDate('1990-05-17').date).toBe('1990-05-17');
  });
});

describe('running history', () => {
  const exportDate = '2026-08-24';

  it('splits by typed dates and keeps the text before the first date', () => {
    const t = 'Antecedentes: sem queixas.\n10/03/2024 Consulta de rotina.\n15/04/24 Retorno com exames.\n20.05.2024 Sem alterações.';
    const { entries, issues } = splitHistory(t, { exportDate });
    expect(entries.map((e) => e.date)).toEqual(['2024-03-10', '2024-04-15', '2024-05-20']);
    expect(entries[0].text.startsWith('Antecedentes')).toBe(true);
    expect(issues).toEqual([]);
  });

  it('flags dates out of order and invalid stamps', () => {
    const t = '10/03/2024 A\n31/02/2024 B\n05/01/2023 C';
    const { entries, issues } = splitHistory(t, { exportDate });
    expect(entries.map((e) => e.date)).toEqual(['2024-03-10', '2023-01-05']);
    expect(entries.map((e) => e.outOfOrder)).toEqual([false, true]);
    expect(issues.sort()).toEqual(['history_dates_out_of_order', 'history_invalid_date_stamp']);
  });

  it('keeps a text without dates as one undated entry', () => {
    expect(splitHistory('Paciente refere melhora.', { exportDate })).toEqual({ entries: [{ date: null, text: 'Paciente refere melhora.' }], issues: ['history_no_dates'] });
  });

  it('keeps the typed date in the text, ignores future dates and merges entries of the same day', () => {
    const { entries } = splitHistory('01/02/2025 A\n01/02/2025 B\n01/01/2030 C', { exportDate });
    expect(historyByDay(entries)).toEqual([{ date: '2025-02-01', text: '01/02/2025 A\n\n01/02/2025 B\n01/01/2030 C', outOfOrder: false }]);
  });
});

describe('templates', () => {
  it('lists merge fields and ignores e-mail addresses', () => {
    expect(mergeFieldsOf('@nome\nContato: clinica@example.com\nTipo @sangue\nCuritiba, @extenso')).toEqual({ fields: ['@extenso', '@nome', '@sangue'], unsupported: ['@sangue'] });
  });

  it('writes the date in words like PersonalMed', () => {
    expect(dateInWords('2026-11-03')).toBe('3 de novembro de 2026');
  });

  it('turns a prescription template into items with route and instructions', () => {
    const t = '@nome\n\n\t\t\tUSO INT\n\n- PRODUTO A 10mg ______ 1 caixa\nTome 1 cp ao dia.\n\n- PRODUTO B _____ Uso contínuo\nTome 1 cp à noite.\nNão interromper.\n\nUso Ext\n- CREME C ____ 1 tubo\nAplicar 2x ao dia.\n\nCuritiba, @extenso';
    const r = parseTemplateItems(t);
    expect(r.kind).toBe('items');
    expect(r.header).toEqual(['@nome']);
    expect(r.footer).toEqual(['Curitiba, @extenso']);
    expect(r.items).toEqual([
      { name: 'PRODUTO A 10mg', quantity: '1 caixa', route: 'USO INT', instructions: 'Tome 1 cp ao dia.' },
      { name: 'PRODUTO B', quantity: 'Uso contínuo', route: 'USO INT', instructions: 'Tome 1 cp à noite.\nNão interromper.' },
      { name: 'CREME C', quantity: '1 tubo', route: 'Uso Ext', instructions: 'Aplicar 2x ao dia.' },
    ]);
  });

  it('keeps templates without items as free text', () => {
    expect(parseTemplateItems('@nome\nAtesto para os devidos fins...').kind).toBe('free_text');
  });
});

describe('agenda', () => {
  const exportDate = '2026-08-24';

  it('maps legacy statuses', () => {
    expect(mapAppointmentStatus('T', '2025-01-10', { exportDate }).status).toBe('realizado');
    expect(mapAppointmentStatus('C', '2025-01-10', { exportDate }).status).toBe('cancelado');
    expect(mapAppointmentStatus('F', '2025-01-10', { exportDate })).toMatchObject({ status: 'faltou', issues: ['status_no_show_target_required'] });
    expect(mapAppointmentStatus('A', '2025-01-10', { exportDate })).toMatchObject({ status: 'realizado', note: 'PersonalMed: A' });
    expect(mapAppointmentStatus('', '2025-01-10', { exportDate })).toMatchObject({ status: null, issues: ['status_unknown_past'] });
    expect(mapAppointmentStatus('', '2026-09-01', { exportDate }).status).toBe('agendado');
  });

  it('finds overlaps per doctor, ignoring cancelled ones', () => {
    const at = (h) => `2026-09-01T${h}:00-03:00`;
    const list = [
      { id: 'a', doctor: 3, start: at('09:00'), end: at('10:00'), status: 'agendado' },
      { id: 'b', doctor: 3, start: at('09:15'), end: at('09:30'), status: 'agendado' },
      { id: 'c', doctor: 3, start: at('09:40'), end: at('09:50'), status: 'agendado' },
      { id: 'd', doctor: 3, start: at('10:00'), end: at('10:20'), status: 'agendado' },
      { id: 'e', doctor: 3, start: at('10:05'), end: at('10:10'), status: 'cancelado' },
      { id: 'f', doctor: 5, start: at('09:00'), end: at('09:20'), status: 'agendado' },
    ];
    expect([...findOverlaps(list)].sort()).toEqual(['b', 'c']);
  });
});

describe('template recognition', () => {
  it('maps ModelType to a kind', () => {
    expect([1, 2, 3, 4].map(templateKind)).toEqual(['receita', 'texto', 'pedido_exame', 'texto']);
  });

  it('needs enough fixed text to recognise a template', () => {
    expect(templateChunks('@nome\nCuritiba, @extenso')).toEqual([]);
    expect(templateChunks('@nome\n- Medicamento sintético ______ 1 caixa\nTomar 1 comprimido ao dia.')).toEqual([
      'medicamento sintetico 1 caixa',
      'tomar 1 comprimido ao dia',
    ]);
  });

  it('counts uses by doctor since a date, ignoring edited copies', () => {
    const templates = [{ key: 'Us05:1', chunks: templateChunks('- Medicamento sintético ______ 1 caixa\nTomar 1 comprimido ao dia.') }];
    const doc = (user, date, qty = '1 caixa') => ({ user, date, text: `PESSOA SINTÉTICA\n- Medicamento sintético ______ ${qty}\nTomar 1 comprimido ao dia.` });
    const usage = templateUsage(templates, [doc(3, '2025-02-01'), doc(3, '2026-01-10'), doc(5, '2025-06-01'), doc(5, '2024-12-31'), doc(5, '2026-02-01', '2 caixas'), { user: 3, date: null, text: '' }], { since: '2025-01-01' });
    expect(usage.get('Us05:1')).toEqual({ uses: 3, byDoctor: { 'user:3': 2, 'user:5': 1 }, lastUsed: '2026-01-10' });
  });
});

describe('"Atenção" alert categories', () => {
  it('flags clinical and administrative content, accents and case aside', () => {
    expect(alertCategories('ALÉRGICA A DIPIRONA. Ligar antes.')).toEqual({
      categories: ['alergia', 'medicamento_citado', 'administrativo'],
      clinical: true,
      administrative: true,
    });
    expect(alertCategories('Faleceu em 2019')).toMatchObject({ categories: ['obito'], clinical: true, administrative: false });
    expect(alertCategories('Prefere a tarde')).toEqual({ categories: [], clinical: false, administrative: false });
  });
});
