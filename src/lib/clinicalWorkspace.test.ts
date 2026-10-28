import { describe,it,expect } from 'vitest';
import { validateWorkItem,ENCOUNTER_TEMPLATES } from './clinicalWorkspace';
describe('physician-authored workspace boundaries',()=>{
  it('requires measurement value, units, date and rejects non-finite values',()=>{
    for(const value of ['', 'NaN','Infinity']) expect(validateWorkItem('observation','Pressão','',{value,unit:'mmHg',date:'2026-10-28'})).toBeTruthy();
    expect(validateWorkItem('observation','Peso','',{value:'0',unit:'kg',date:'2026-10-28'})).toBeNull();
    expect(validateWorkItem('observation','Peso','',{value:'62',unit:'kg',date:'2026-02-31'})).toBeTruthy();
  });
  it('requires dating provenance and actual reviewed text',()=>{
    expect(validateWorkItem('pregnancy','Gestação','',{date:'2027-06-01'})).toBeTruthy();
    expect(validateWorkItem('draft','Consulta','   ',{})).toBeTruthy();
    expect(validateWorkItem('draft','Consulta','Texto exato do médico',{})).toBeNull();
  });
  it('specialty templates contain prompts, never fabricated findings',()=>{
    expect(Object.keys(ENCOUNTER_TEMPLATES)).toEqual(['livre','ginecologia','prenatal','urologia']);
    expect(Object.values(ENCOUNTER_TEMPLATES).join(' ')).not.toMatch(/sem alterações|nega alergias|normal/i);
  });
});
