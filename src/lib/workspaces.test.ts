import { describe, expect, it } from 'vitest';
import { workspaceAt, workspacesFor } from './workspaces';
import type { ClinicAccess } from '@/features/reception/contracts';
const clinical: ClinicAccess = { kind: 'clinical', active: true, admin: false, actorId: '11111111-1111-4111-8111-111111111111', clinic: { id: '22222222-2222-4222-8222-222222222222', name: 'Clínica sintética' }, doctors: [], staff: [] };
describe('workspaces follow existing capabilities, never an email exception', () => {
  it('lets an active clinical administrator reach all three environments', () => {
    expect(workspacesFor({ ...clinical, admin: true }).map(w => [w.id, w.to])).toEqual([['clinical', '/'], ['reception', '/recepcao'], ['finance', '/financeiro']]);
  });
  it('keeps a clinic doctor in clinical/own-finance without a reception shortcut', () => {
    expect(workspacesFor(clinical).map(w => w.id)).toEqual(['clinical', 'finance']);
  });
  it.each([false, true])('keeps reception inside its route namespace even with admin=%s', admin => {
    expect(workspacesFor({ ...clinical, kind: 'reception', admin }).map(w => [w.id, w.to])).toEqual([['reception', '/recepcao'], ['finance', '/recepcao/financeiro']]);
  });
  it.each([{ ...clinical, clinic: null }, { ...clinical, active: false }])('does not remove a doctor’s private workspace when clinic access is absent', access => {
    expect(workspacesFor(access).map(w => w.id)).toEqual(['clinical']);
  });
  it.each([null, undefined, { ...clinical, kind: 'reception', active: false }, { ...clinical, kind: 'reception', clinic: null }])('offers no operational area for an unverified/inactive reception context', access => {
    expect(workspacesFor(access as ClinicAccess | null | undefined)).toEqual([]);
  });
  it('does not interpret an unknown kind with admin:true as access', () => {
    expect(workspacesFor({ ...clinical, kind: 'unexpected', admin: true } as unknown as ClinicAccess)).toEqual([]);
  });
  it.each([
    ['/', 'clinical'], ['/agenda', 'clinical'], ['/financeiro', 'finance'], ['/recepcao/financeiro', 'finance'],
    ['/recepcao', 'reception'], ['/RECEPCAO', 'reception'], ['/%72ecepcao', 'reception'], ['/RECEPCAO/financeiro', 'finance'], ['/recepcao/agenda', 'reception'], ['/recepcao/pre-consultas', 'reception'],
  ])('identifies the current environment at %s', (path, expected) => expect(workspaceAt(path)).toBe(expected));
});
