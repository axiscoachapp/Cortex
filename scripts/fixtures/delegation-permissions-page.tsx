import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import DelegationPermissions from '@/features/reception/DelegationPermissions';
import { Button } from '@/components/ui/button';
import '@/index.css';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const clinic = '66666666-6666-4666-8666-666666666666', staff = '77777777-7777-4777-8777-777777777777';
const admin = new URLSearchParams(window.location.search).has('admin');
function App() {
  const { user, loading, signIn } = useAuth();
  if (loading) return <p>Verificando ensaio…</p>;
  if (!user) return <Button onClick={() => void signIn('review@example.invalid', 'synthetic-password')}>Entrar no ensaio</Button>;
  return <MemoryRouter initialEntries={[admin ? `/permissoes-recepcao?clinica=${clinic}` : '/permissoes-recepcao']}><ClinicAccessContext.Provider value={{ actorId: user.id, kind: 'clinical', active: true, admin, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [{ id: staff, name: 'Recepção sintética', active: true, doctorIds: [] }] }}><DelegationPermissions /></ClinicAccessContext.Provider></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><App /></AuthProvider></QueryClientProvider>);
