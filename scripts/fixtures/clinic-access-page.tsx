// Browser test entry only. Uses the real gate/API/auth and synthetic loopback server.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ClinicAccessGate } from '@/features/reception/ClinicAccessGate';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import '@/index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function ClinicalPage() {
  const [draft, setDraft] = useState('');
  const [document, setDocument] = useState('');
  const [open, setOpen] = useState(false);
  const hidden = useSessionHidden();
  return <div data-clinic-page-shell><main className="h-[100dvh] flex flex-col bg-background pt-14">
    <section className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Consulta sintética</h1>
      <label className="block">Rascunho clínico<textarea className="block w-full border rounded p-2" value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <Button onClick={() => setOpen(true)}>Abrir documento</Button>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Documento sintético</DialogTitle><DialogDescription>Somente dados sintéticos.</DialogDescription>
        <label>Texto do documento<textarea className="block w-full border rounded p-2" value={document} onChange={event => setDocument(event.target.value)} /></label>
      </DialogContent></Dialog>
      {!hidden && createPortal(<div role="status" data-clinical-capture aria-label="Captura sintética" className="fixed top-0 inset-x-0 z-40 min-h-14 border-b bg-card px-3 py-2 flex flex-wrap items-center justify-center gap-3">
        <span>Pessoa sintética · Gravando 00:01</span><Button size="sm">Pausar gravação</Button><Button size="sm">Parar e salvar áudio</Button>
      </div>, window.document.body)}
    </section>
    <footer className="shrink-0 border-t p-3"><Button onClick={() => void client.invalidateQueries({ queryKey: ['clinic-access'] })}>Conferir acesso</Button></footer>
  </main></div>;
}
export function App() {
  const { user, loading, signIn } = useAuth();
  if (loading) return <p>Verificando sessão sintética…</p>;
  if (!user) return <Button onClick={() => void signIn('admin@example.invalid', 'synthetic-password')}>Entrar no ensaio</Button>;
  return <MemoryRouter><Routes><Route element={<ClinicAccessGate><Outlet /></ClinicAccessGate>}><Route path="/" element={<ClinicalPage />} /></Route></Routes></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><div data-session-content><App /></div></AuthProvider></QueryClientProvider>);
