import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import { receptionApi } from '@/features/reception/api';
import TeamSettings from '@/features/reception/TeamSettings';
import DelegationPermissions from '@/features/reception/DelegationPermissions';
import { Button } from '@/components/ui/button';
import '@/index.css';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Team() {
  const { user } = useAuth();
  const access = useQuery({ queryKey: ['clinic-access', user!.id], queryFn: receptionApi.access });
  if (!access.data) return <p>Verificando equipe sintética…</p>;
  return <ClinicAccessContext.Provider value={access.data}><Routes><Route path="/recepcao/equipe" element={<main className="p-4"><TeamSettings /></main>} /><Route path="/permissoes-recepcao" element={<DelegationPermissions />} /></Routes></ClinicAccessContext.Provider>;
}
function App() {
  const { user, loading, signIn } = useAuth();
  if (loading) return <p>Verificando ensaio…</p>;
  if (!user) return <Button onClick={() => void signIn('review@example.invalid', 'synthetic-password')}>Entrar no ensaio</Button>;
  return <MemoryRouter initialEntries={['/recepcao/equipe']}><Team /></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><App /></AuthProvider></QueryClientProvider>);
