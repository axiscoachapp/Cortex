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
});
