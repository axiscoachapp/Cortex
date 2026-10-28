import type { TablesInsert } from '@/integrations/supabase/types';

export type ImportTarget = 'name' | 'age' | 'birthdate' | 'phone' | 'email' | 'profession' | 'skip';
export type ImportedPatient = TablesInsert<'patients'> & { id: string; name: string; age: number };
export interface ImportRejection { row: number; reason: string }

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const first = text.slice(0, 2000).split(/\r?\n/)[0] ?? '';
  const delimiter = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let field = '', quoted = false;
  const line: string[] = [];
  const pushField = () => { line.push(field); field = ''; };
  const pushLine = () => { pushField(); if (line.some(cell => cell.trim())) rows.push([...line]); line.length = 0; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) pushField();
    else if (char === '\n') pushLine();
    else if (char !== '\r') field += char;
  }
  if (quoted) throw new Error('Há aspas sem fechamento no CSV. Corrija o arquivo e tente novamente.');
  if (field.length || line.length) pushLine();
  const headers = (rows.shift() ?? []).map(value => value.trim().replace(/^\uFEFF/, ''));
  if (headers.length > 100 || rows.length > 10_000) throw new Error('O CSV deve conter até 100 colunas e 10.000 pacientes. Divida o arquivo.');
  if (rows.some(row => row.length !== headers.length)) throw new Error('Há linhas com quantidade diferente de colunas. Confira as aspas e o separador do CSV.');
  return { headers, rows };
}

export function ageFromBirthdate(value: string, today: string): number | null {
  const raw = value.trim();
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!br && !iso) return null;
  const [year, month, day] = br ? [Number(br[3]), Number(br[2]), Number(br[1])] : [Number(iso![1]), Number(iso![2]), Number(iso![3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const [nowYear, nowMonth, nowDay] = today.split('-').map(Number);
  const age = nowYear - year - (nowMonth < month || (nowMonth === month && nowDay < day) ? 1 : 0);
  return age >= 0 && age <= 130 ? age : null;
}

export function preparePatientImport(rows: string[][], mapping: ImportTarget[], userId: string, today: string) {
  const records: ImportedPatient[] = [], rejected: ImportRejection[] = [];
  rows.forEach((row, index) => {
    const field = (target: ImportTarget) => (row[mapping.indexOf(target)] ?? '').trim();
    const name = field('name'), ageValue = field('age'), birthdate = field('birthdate');
    const age = ageValue !== '' && /^\d+$/.test(ageValue) ? Number(ageValue) : birthdate ? ageFromBirthdate(birthdate, today) : null;
    let reason = '';
    if (!name) reason = 'Nome ausente';
    else if (name.length > 120) reason = 'Nome excede 120 caracteres';
    else if (age === null || !Number.isInteger(age) || age < 0 || age > 130 || (ageValue !== '' && !/^\d+$/.test(ageValue))) reason = 'Idade ou data de nascimento ausente ou inválida';
    else if (birthdate && (ageFromBirthdate(birthdate, today) === null || (ageValue && ageFromBirthdate(birthdate, today) !== age))) reason = 'Data de nascimento inválida ou incompatível com a idade';
    else if (field('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field('email'))) reason = 'Email inválido';
    if (reason) { rejected.push({ row: index + 2, reason }); return; }
    records.push({ id: crypto.randomUUID(), user_id: userId, name, age: age!, last_visit: today, status: 'novo', phone: field('phone') || null, email: field('email') || null, profession: field('profession') || '' });
  });
  return { records, rejected };
}
