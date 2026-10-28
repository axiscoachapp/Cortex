import { describe, expect, it } from 'vitest';
import { assertAudioPath, assertPatientFilePath, assertPrescriptionPath, assertOwnedStoragePath, listStoragePrefix, removeStoragePrefix } from '../../supabase/functions/_shared/storage';

const user = '11111111-1111-4111-8111-111111111111';
const patient = '22222222-2222-4222-8222-222222222222';
const rx = '33333333-3333-4333-8333-333333333333';

describe('privileged storage boundaries', () => {
  it('accepts canonical owned object paths', () => {
    expect(assertAudioPath(`consultations/${user}/recording.webm`, user)).toContain(user);
    expect(assertPatientFilePath(`patients/${user}/${patient}/exame médico.pdf`, user, patient)).toContain(patient);
    expect(assertPrescriptionPath(`rx/${user}/${rx}.pdf`, user, rx)).toContain(rx);
  });
  it.each(['../victim/file', '%2e%2e/victim/file', '%252e%252e/file', 'a\\..\\victim', '/file', 'file?x=1', 'file#x', 'a//b', 'a/./b'])('rejects URL normalization alias %s', (suffix) => {
    expect(() => assertAudioPath(`consultations/${user}/${suffix}`, user)).toThrow();
  });
  it('rejects a different owner, patient, and prescription', () => {
    expect(() => assertAudioPath(`consultations/${patient}/file`, user)).toThrow();
    expect(() => assertPatientFilePath(`patients/${user}/${rx}/file`, user, patient)).toThrow();
    expect(() => assertPrescriptionPath(`/rx/${user}/${rx}.pdf`, user, rx)).toThrow();
    expect(() => assertPrescriptionPath('../patient-files/secret.pdf', user, rx)).toThrow();
  });
  it('authorizes export of owned orphan files without permitting bucket escape', () => {
    expect(assertOwnedStoragePath('prescriptions',`rx/${user}/orphan.pdf`,user)).toContain('orphan');
    expect(()=>assertOwnedStoragePath('prescriptions',`rx/${patient}/file.pdf`,user)).toThrow();
    expect(()=>assertOwnedStoragePath('unknown',`rx/${user}/file.pdf`,user)).toThrow();
    expect(()=>assertOwnedStoragePath('prescriptions',`rx/${user}/../../patient-files/file`,user)).toThrow();
  });
  it('cleans all pages and nested orphan files while preserving other users', async () => {
    const files = new Set([...Array.from({length: 205}, (_, i) => `patients/${user}/${patient}/f${i}.pdf`), `patients/${user}/orphan.pdf`, `patients/${user}/legacy%20file.pdf`, `patients/${patient}/keep.pdf`]);
    const storage = { from: () => ({
      list: async (prefix: string, opts: {offset: number; limit: number}) => {
        const entries = new Map<string, {name: string; id: string | null}>();
        for (const path of files) if (path.startsWith(prefix + '/')) {
          const rest = path.slice(prefix.length + 1); const [name, ...nested] = rest.split('/');
          entries.set(name, {name, id: nested.length ? null : path});
        }
        return {data: [...entries.values()].sort((a,b) => a.name.localeCompare(b.name)).slice(opts.offset, opts.offset + opts.limit), error: null};
      },
      remove: async (paths: string[]) => { paths.forEach(path => files.delete(path)); return {data: [], error: null}; },
    })};
    const exported = await listStoragePrefix(storage, 'patient-files', `patients/${user}`);
    expect(exported).toHaveLength(207);
    expect(exported.some(file=>file.path.endsWith('legacy%20file.pdf'))).toBe(true);
    expect(exported.every(file=>file.path.startsWith(`patients/${user}/`))).toBe(true);
    await removeStoragePrefix(storage, 'patient-files', `patients/${user}`);
    expect([...files]).toEqual([`patients/${patient}/keep.pdf`]);
    await removeStoragePrefix(storage, 'patient-files', `patients/${user}`);
  });
  it('does not report deletion success when storage removal fails', async () => {
    const storage = { from: () => ({
      list: async () => ({data: [{name:'file.pdf', id:'id'}], error: null}),
      remove: async () => ({data:null, error: {message:'unavailable'}}),
    })};
    await expect(removeStoragePrefix(storage, 'patient-files', `patients/${user}`)).rejects.toThrow();
  });
  it('drains from the beginning when a concurrent delete shifts a full page', async () => {
    const prefix = `patients/${user}`;
    const files = new Set(Array.from({length:101},(_,i)=>`${prefix}/${String(i).padStart(3,'0')}.pdf`));
    let first = true;
    const storage = {from:()=>({
      list:async (_prefix:string, options:{offset:number;limit:number})=>{
        const data = [...files].sort().slice(options.offset,options.offset+options.limit).map(path=>({name:path.slice(prefix.length+1),id:path}));
        if(first) { first=false; files.delete(`${prefix}/000.pdf`); }
        return {data,error:null};
      },
      remove:async (paths:string[])=>{paths.forEach(path=>files.delete(path));return {data:[],error:null};},
    })};
    await removeStoragePrefix(storage,'patient-files',prefix);
    expect(files.size).toBe(0);
  });
});
