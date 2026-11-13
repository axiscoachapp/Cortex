import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bmpToPng, findImage, storableImage } from './image.mjs';
import { buildAgenda, buildChartClinical, buildFiles, buildPerson, mapBloodType, mapCivilStatus, obstetricHistory, sheetLabel, sheetLines } from './staging.mjs';

// Invented data only.
const ctx = { sourceInstance: 'pm-test', batchId: 'test', exportDate: '2026-08-24', importDate: '2026-11-13' };

describe('registration extras', () => {
  it('maps the usual civil status codes and refuses an unknown one', () => {
    expect(mapCivilStatus('C')).toEqual({ label: 'Casado(a)', issues: [] });
    expect(mapCivilStatus(' s ')).toEqual({ label: 'Solteiro(a)', issues: [] });
    expect(mapCivilStatus('P')).toEqual({ label: null, issues: ['civil_status_unknown_code'] });
    expect(mapCivilStatus('')).toEqual({ label: null, issues: [] });
  });
  it('accepts only the eight blood types', () => {
    expect(mapBloodType('o +')).toBe('O+');
    expect(mapBloodType('AB-')).toBe('AB-');
    expect(mapBloodType('X+')).toBeNull();
  });
  it('carries civil status, blood type and the registration note', () => {
    const out = buildPerson(ctx, { PCod: 7, Name: 'Paciente Sintética Exemplo', BirthDate: '1990-01-31', Sex: 'feminino', CivilStatus: 'C', BloodType: 'B+', ObservationText: 'Prefere contato à tarde' }, [{ user: 2, firstVisit: '2020-01-10', lastVisit: '2026-05-10', hasConsultations: true }]);
    expect(out.find((e) => e.sourceEntity === 'person').payload).toMatchObject({ civilStatus: 'Casado(a)', bloodType: 'B+', registrationNote: 'Prefere contato à tarde' });
    expect(out.find((e) => e.sourceEntity === 'chart').payload).toMatchObject({ civil_status: 'Casado(a)', blood_type: 'B+' });
  });
});

describe('prenatal visit, obstetric history and sheets', () => {
  it('reads the edema code and keeps the touch exam', () => {
    const encounters = new Map([['2024-05-09', { evolutions: [], documents: [], cids: [], prenatal: [{ ig: 34, weight: 69, pressure: '110/70', au: 32, bcf: '140', mf: 1, edema: 1, touch: 'colo fechado' }, { ig: 35, edema: 3 }, { ig: 36, edema: 0 }], appointmentKey: null, appointmentStart: null }]]);
    const note = buildChartClinical(ctx, { pcod: 7, user: 2, patientTargetId: 'p' }, { encounters, pages: [], pregnancies: [] }).find((e) => e.sourceEntity === 'consultation').payload.soap_note;
    expect(note).toContain('Edema: ausente · Toque: colo fechado');
    expect(note).toContain('IG: 35 semanas · Edema: ++');
    expect(note).toMatch(/IG: 36 semanas$/m);
  });
  it('lists every pregnancy without the child\'s name', () => {
    const text = obstetricHistory([
      { number: 2, dum: '2023-09-02', dpp: '2024-06-08', dppSource: 'DUM', igFirst: 8, weight: 58, bloodType: 'b+', parturition: '1899-12-30', notes: '' },
      { number: 1, dum: '2020-10-02', dpp: '2021-07-09', dppSource: 'USG', dppEcho: '2021-07-11', parturition: '2021-07-09', deliveryType: 'Cesárea', childSex: 'F', notes: 'sem intercorrências' },
      { number: 3, dum: '1899-12-30', dpp: null },
    ], '2026-08-24');
    expect(text).toBe('## Histórico obstétrico (fichas de gestação)\n\n- Gestação 1: DUM 02/10/2020 · DPP 09/07/2021 (pela USG) · DPP pela USG 11/07/2021 · parto em 09/07/2021 · tipo de parto: Cesárea · sexo do recém-nascido: F\n  Observações: sem intercorrências\n- Gestação 2: DUM 02/09/2023 · DPP 08/06/2024 (pela DUM) · IG na abertura: 8 semanas · peso inicial 58 kg · tipo sanguíneo B+');
    expect(obstetricHistory([], '2026-08-24')).toBeNull();
  });
  it('turns a sheet row into labelled lines, leaving out what says nothing', () => {
    expect(sheetLabel('IdadeMenopausa')).toBe('Idade menopausa');
    expect(sheetLabel('DIUUsa')).toBe('Diu usa');
    expect(sheetLines([['IdadeMenopausa', 49], ['ReposHorm', true], ['Pilula', false], ['Dose', ''], ['Data', '2021-03-08'], ['Zero', '1899-12-30'], ['Obs', ' usa adesivo ']])).toEqual(['Idade menopausa: 49', 'Repos horm: sim', 'Data: 08/03/2021', 'Obs: usa adesivo']);
  });
  it('adds obstetric history and sheets to the medical history', () => {
    const out = buildChartClinical(ctx, { pcod: 7, user: 2, patientTargetId: 'p' }, { encounters: new Map(), pages: [], pregnancies: [{ number: 1, dum: '2020-10-02', dpp: '2021-07-09', dppSource: 'DUM' }], sheets: [{ title: 'Climatério (ficha do PersonalMed)', date: null, lines: ['Idade menopausa: 49'] }, { title: 'Vazia', lines: [] }] });
    const history = out.find((e) => e.sourceEntity === 'medical_history').payload.text;
    expect(history).toContain('## Histórico obstétrico (fichas de gestação)');
    expect(history).toContain('## Climatério (ficha do PersonalMed)\n\n- Idade menopausa: 49');
    expect(history).not.toContain('Vazia');
  });
});

describe('agenda details', () => {
  const chartIds = new Map([['7|2', 'chart-id']]);
  it('keeps arrival, start of care and the plan of the visit, and the person behind a visit without chart', () => {
    const [a, b] = buildAgenda(ctx, [
      { user: 2, date: '2024-05-09', startMinutes: 600, duration: 20, slotType: 'C', estado: 'T', pcod: 7, typeLabel: 'CONS', arrivalMinutes: 590, careStartMinutes: 612, carrier: 'UNIMED' },
      { user: 4, date: '2024-05-10', startMinutes: 600, duration: 20, slotType: 'C', estado: 'T', pcod: 7, typeLabel: 'CONS' },
    ], chartIds).filter((e) => e.sourceEntity === 'appointment');
    expect(a.payload).toMatchObject({ status: 'realizado', notes: 'Convênio no agendamento: UNIMED · Início do atendimento: 10:12', checked_in_at: '2024-05-09T12:50:00.000Z', personRef: 'pcod:7', patientTargetId: 'chart-id' });
    expect(b.payload).toMatchObject({ patientTargetId: null, personRef: 'pcod:7' });
    expect(b.issues).toContain('appointment_chart_missing');
  });
  it('gives a walk-in visit its own key, even at the time of a booked slot', () => {
    const rows = [
      { user: 2, date: '2010-03-01', startMinutes: 600, duration: 20, slotType: 'C', estado: 'C', pcod: 7 },
      { user: 2, date: '2010-03-01', startMinutes: 600, duration: 0, slotType: 'C', estado: 'T', pcod: 7, walkIn: 91 },
    ];
    const out = buildAgenda(ctx, rows, chartIds).filter((e) => e.sourceEntity === 'appointment');
    expect(new Set(out.map((e) => e.targetId)).size).toBe(2);
    expect(out[1].sourceRecordId).toBe('walkin:91');
    expect(out[1].payload.notes).toContain('Pronto atendimento (fila do PersonalMed)');
  });
});

describe('images', () => {
  // A 2x2 bottom-up 24-bit BMP: row 0 (bottom) blue, green; row 1 (top) red, white.
  const bmp = Buffer.alloc(54 + 16);
  bmp.write('BM', 0, 'latin1');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(2, 18);
  bmp.writeInt32LE(2, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, /* top row */ 0, 0, 255, 255, 255, 255, 0, 0]).copy(bmp, 54);
  it('finds an image with or without the 8-byte graphic prefix', () => {
    expect(findImage(bmp)?.format).toBe('bmp');
    expect(findImage(Buffer.concat([Buffer.alloc(8), bmp]))?.format).toBe('bmp');
    expect(findImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))?.format).toBe('jpeg');
    expect(findImage(Buffer.from('texto qualquer sem imagem'))).toBeNull();
  });
  it('converts BMP to a PNG with the same pixels, top row first', () => {
    const png = bmpToPng(bmp);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    const idat = png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8);
    // Each row: filter byte 0, then RGB of the two pixels.
    expect([...inflateSync(idat)]).toEqual([0, 255, 0, 0, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0]);
    expect(storableImage(Buffer.concat([Buffer.alloc(8), bmp]))?.mime).toBe('image/png');
    expect(bmpToPng(Buffer.from('BM-not-a-bitmap'))).toBeNull();
  });
  it('builds a file envelope and refuses a format Cortex does not store', () => {
    const chart = { pcod: 7, user: 2, patientTargetId: 'p' };
    const [ok, bad] = buildFiles(ctx, chart, [
      { source: 'CO52', key: { codexame: 3, n: 1 }, date: '2020-02-03', description: 'Exame sintético', mime: 'image/png', bytes: Buffer.from('png') },
      { source: 'Clini_04', key: { imagecod: 9, n: 1 }, date: null, description: '', mime: 'image/tiff', bytes: Buffer.from('tif') },
    ]);
    expect(ok).toMatchObject({ sourceEntity: 'file', mappingStatus: 'ready', payload: { file_name: 'personalmed-co52-3-1.png', tag: 'importado-personalmed', date: '2020-02-03', size_bytes: 3 } });
    expect(bad).toMatchObject({ mappingStatus: 'rejected', issues: ['file_format_unsupported'] });
  });
});
