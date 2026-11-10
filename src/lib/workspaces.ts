import { matchRoutes } from 'react-router-dom';
import type { ClinicAccess } from '@/features/reception/contracts';
export type WorkspaceId = 'clinical' | 'reception' | 'finance';
export type Workspace = { id: WorkspaceId; label: string; description: string; to: string };
const clinical: Workspace = { id: 'clinical', label: 'Consultório', description: 'Seu dia, pacientes e atendimento', to: '/' };
const reception: Workspace = { id: 'reception', label: 'Recepção', description: 'Equipe, agenda e atendimento ao paciente', to: '/recepcao' };
const finance: Workspace = { id: 'finance', label: 'Financeiro', description: 'Cobranças, recebimentos e convênios', to: '/financeiro' };
/** Navigation only. All destinations retain their own server-backed access gates. */
export function workspacesFor(access: ClinicAccess | null | undefined): Workspace[] {
  if (!access) return [];
  const operational = access.active && !!access.clinic;
  if (access.kind === 'reception') return operational ? [reception, { ...finance, to: '/recepcao/financeiro' }] : [];
  if (access.kind !== 'clinical') return [];
  return [clinical, ...(operational && access.admin ? [reception] : []), ...(operational ? [finance] : [])];
}
export function workspaceAt(pathname: string): WorkspaceId {
  if (matchRoutes([{ path: '/financeiro' }, { path: '/recepcao/financeiro' }], pathname)) return 'finance';
  return isReceptionPath(pathname) ? 'reception' : 'clinical';
}

export const isReceptionPath = (pathname: string) => matchRoutes([{ path: '/recepcao/*' }], pathname) !== null;
