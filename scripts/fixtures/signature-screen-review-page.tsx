// Real signature components in an isolated browser shell. Synthetic API only.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SessionAssurance } from '@/components/SessionAssurance';
import { PrescriptionList } from '@/components/PrescriptionList';
import SignatureReturn from '@/pages/SignatureReturn';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import '@/index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const mode = new URLSearchParams(window.location.search).get('callback');
const initial = mode === 'denied' ? '/assinatura/retorno?error=access_denied'
  : mode ? '/assinatura/retorno?code=synthetic-code&state=synthetic-state' : '/';
export function App() {
  const { user, loading, signIn } = useAuth();
  if (loading) return <p>Verificando ensaio sintético…</p>;
  if (!user) return <Button onClick={() => void signIn('review@example.invalid', 'synthetic-password')}>Entrar no ensaio</Button>;
  return <MemoryRouter initialEntries={[initial]}><SessionAssurance><Routes>
    <Route path="/" element={<main className="max-w-3xl mx-auto p-6 space-y-5"><h1 className="font-semibold">Documentos sintéticos</h1><PrescriptionList patientId="22222222-2222-4222-8222-222222222222"/></main>} />
    <Route path="/assinatura/retorno" element={<SignatureReturn/>}/>
    <Route path="/destino-sintetico" element={<h1>Retorno ao local salvo</h1>}/>
    <Route path="/seguranca" element={<h1>Configuração de MFA</h1>}/>
  </Routes></SessionAssurance><Toaster/></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><App/></AuthProvider></QueryClientProvider>);
