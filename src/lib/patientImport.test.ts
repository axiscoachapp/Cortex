import { describe, expect, it } from 'vitest';
import { ageFromBirthdate, parseCSV, preparePatientImport } from './patientImport';

describe('Patient import validation', () => {
  it('rejects impossible calendar dates and calculates age by birthday', () => {
    expect(ageFromBirthdate('31/02/2000', '2026-10-27')).toBeNull();
    expect(ageFromBirthdate('28/10/2000', '2026-10-27')).toBe(25);
    expect(ageFromBirthdate('2026-10-27', '2026-10-27')).toBe(0);
  });
  it('parses escaped quotes and multiline fields and rejects unfinished quotes', () => {
    expect(parseCSV('Nome;Profissão\n"Ana ""A""";"Linha 1\nLinha 2"').rows).toEqual([['Ana "A"', 'Linha 1\nLinha 2']]);
    expect(() => parseCSV('Nome\n"sem fechamento')).toThrow();
  });
  it('reports every rejected row instead of silently dropping or inventing ages', () => {
    const result = preparePatientImport([['Ana', '0'], ['', '40'], ['Bia', '-1'], ['Caio', '']], ['name', 'age'], 'doctor', '2026-10-27');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].age).toBe(0);
    expect(result.rejected.map(row => row.row)).toEqual([3, 4, 5]);
  });
  it('does not manufacture a completed visit for newly imported people', () => {
    const result = preparePatientImport([['Pessoa', '40']], ['name', 'age'], 'doctor', '2026-10-28');
    expect(result.records[0].last_visit).toBeNull();
  });
});

describe('CSV import robustness (review fixes)', () => {
  it('decodes Windows-1252 exports from Excel pt-BR without corrupting accents', async () => {
    const { decodeCsvBytes } = await import('./patientImport');
    // "Nome;Idade\nJoão;30" encoded as Windows-1252 (ã = 0xE3)
    const bytes = new Uint8Array([78, 111, 109, 101, 59, 73, 100, 97, 100, 101, 10, 74, 111, 0xe3, 111, 59, 51, 48]);
    expect(decodeCsvBytes(bytes.buffer)).toBe('Nome;Idade\nJoão;30');
  });
  it('decodes UTF-8 with a BOM', async () => {
    const { decodeCsvBytes } = await import('./patientImport');
    const bytes = new TextEncoder().encode('\uFEFFNome\nJoão');
    expect(decodeCsvBytes(bytes.buffer)).toBe('Nome\nJoão');
  });
  it('keeps the birthdate and skips patients that already exist', async () => {
    const { preparePatientImport, importIdentity } = await import('./patientImport');
    const existing = new Set([importIdentity('Maria Souza', '1980-05-02', 46)]);
    const { records, rejected } = preparePatientImport(
      [
        ['Maria Souza', '02/05/1980'],
        ['Ana Lima', '10/01/1990'],
        ['Ana Lima', '10/01/1990'],
      ],
      ['name', 'birthdate'],
      'doctor',
      '2026-11-01',
      existing,
    );
    expect(records.map((r) => [r.name, r.date_of_birth])).toEqual([['Ana Lima', '1990-01-10']]);
    expect(rejected.map((r) => r.row)).toEqual([2, 4]);
  });
});
