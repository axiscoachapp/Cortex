// Browser-only synthetic assurance responses. The gates, AuthProvider, scoped
// clinic transport, Radix modal stack and document state are real components.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SessionAssurance } from '@/components/SessionAssurance';
import { ClinicAccessGate } from '@/features/reception/ClinicAccessGate';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import '@/index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const state = { mode: 'allowed', factorFailure: false, invalidCode: false, challenges: 0 };
supabase.auth.mfa.getAuthenticatorAssuranceLevel = async () => {
  if (state.mode === 'error') return { data: null, error: new Error('Synthetic assurance unavailable') };
  return { data: { currentLevel: state.mode === 'factor' ? 'aal1' : 'aal2', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null };
};
supabase.auth.mfa.listFactors = async () => state.factorFailure
  ? { data: null, error: new Error('Synthetic factor unavailable') }
  : { data: { all: [], phone: [], totp: [{ id: 'factor-synthetic', status: 'verified', friendly_name: 'Autenticador sintético' }] }, error: null };
supabase.auth.mfa.challengeAndVerify = async () => {
  state.challenges++;
  if (state.invalidCode) return { data: null, error: { code: 'mfa_verification_failed' } };
  state.mode = 'allowed';
  return { data: {}, error: null };
};
Object.assign(window, { syntheticAssurance: {
  set: (next: Partial<typeof state>) => Object.assign(state, next),
  recheck: () => client.invalidateQueries({ queryKey: ['session-assurance'] }),
  clinicRecheck: () => client.invalidateQueries({ queryKey: ['clinic-access'] }),
  metrics: () => ({ challenges: state.challenges }),
} });

export function Workspace() {
  const [draft, setDraft] = useState('');
  const [document, setDocument] = useState('');
  const [open, setOpen] = useState(false);
  const hidden = useSessionHidden();
  useUnsavedChanges(!!draft || !!document);
  return <main className="min-h-[100dvh] bg-background p-6 pt-20 space-y-4">
    <h1 className="text-xl font-semibold">Consulta sintética</h1>
    <label className="block">Rascunho clínico<textarea className="block w-full border p-2" value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <Button onClick={() => setOpen(true)}>Abrir documento</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Documento sintético</DialogTitle><DialogDescription>Somente dados sintéticos.</DialogDescription>
      <label>Texto do documento<textarea className="block w-full border p-2" value={document} onChange={event => setDocument(event.target.value)} /></label>
    </DialogContent></Dialog>
    {!hidden && createPortal(<div role="status" data-clinical-capture aria-label="Captura sintética" className="fixed top-0 inset-x-0 z-40 bg-card p-3">Captura sintética preservada</div>, window.document.body)}
  </main>;
}
export function App() {
  const { user, loading, signIn } = useAuth();
  if (loading) return <p>Verificando sessão sintética…</p>;
  if (!user) return <Button onClick={() => void signIn('admin@example.invalid', 'synthetic-password')}>Entrar no ensaio</Button>;
  return <MemoryRouter><Routes><Route element={<SessionAssurance key={user.id}><ClinicAccessGate><Outlet /></ClinicAccessGate></SessionAssurance>}>
    <Route path="/" element={<Workspace />} />
  </Route></Routes></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><App /></AuthProvider></QueryClientProvider>);
