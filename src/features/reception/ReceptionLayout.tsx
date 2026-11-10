import { Outlet, matchRoutes, useLocation } from 'react-router-dom';
import { WorkspaceShell } from '@/components/WorkspaceShell';

const sections = [
  { path: '/recepcao', id: 'Atendimentos' },
  { path: '/recepcao/agenda', id: 'Agenda da equipe' },
  { path: '/recepcao/contatos', id: 'Contatos' },
  { path: '/recepcao/pre-consultas', id: 'Pré-consultas' },
  { path: '/recepcao/financeiro', id: 'Financeiro' },
  { path: '/recepcao/painel', id: 'Indicadores' },
  { path: '/recepcao/equipe', id: 'Equipe e permissões' },
];

export default function ReceptionLayout() {
  const { pathname } = useLocation();
  const section = matchRoutes(sections, pathname)?.at(-1)?.route.id ?? 'Recepção';
  return <WorkspaceShell section={section}><Outlet /></WorkspaceShell>;
}
