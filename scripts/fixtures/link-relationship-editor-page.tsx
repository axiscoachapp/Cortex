import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { UnsavedChangesRouteGuard } from '@/hooks/useUnsavedChanges';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import { receptionApi } from '@/features/reception/api';
import { CaseWorkspace } from '@/features/reception/CaseWorkspace';
import { Button } from '@/components/ui/button';
import '@/index.css';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function CasePage() {
  const { user } = useAuth();
  const access = useQuery({ queryKey: ['clinic-access', user!.id], queryFn: receptionApi.access });
  const detail = useQuery({ queryKey: ['reception', user!.id, 'case', '99999999-9999-4999-8999-999999999999'], queryFn: () => receptionApi.case('99999999-9999-4999-8999-999999999999') });
  if (!access.data || !detail.data) return <p>Carregando atendimento sintético…</p>;
  return <ClinicAccessContext.Provider value={access.data}><main className="mx-auto max-w-4xl p-4"><CaseWorkspace key={detail.data.id} data={detail.data} /></main></ClinicAccessContext.Provider>;
}
const router = createMemoryRouter([{ element: <><UnsavedChangesRouteGuard /><Outlet /></>, children: [{ path: '/recepcao', element: <CasePage /> }, { path: '/recepcao/agenda', element: <h1>Agenda sintética</h1> }] }], { initialEntries: ['/recepcao'] });
function App() {
  const { user, loading, signIn } = useAuth();
  if (loading) return <p>Verificando ensaio…</p>;
  if (!user) return <Button onClick={() => void signIn('review@example.invalid', 'synthetic-password')}>Entrar no ensaio</Button>;
  return <RouterProvider router={router} />;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><App /></AuthProvider></QueryClientProvider>);
