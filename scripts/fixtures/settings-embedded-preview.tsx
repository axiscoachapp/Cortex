// Test-only host for K4 while C5 is developed separately. Synthetic loopback API only.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useNavigate, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { ClinicAccessContext } from '../../src/features/reception/accessContext';
import { receptionApi } from '../../src/features/reception/api';
import DelegationPermissions from '../../src/features/reception/DelegationPermissions';
import TeamSettings from '../../src/features/reception/TeamSettings';
import '../../src/index.css';

export function Preview() {
  const auth = useAuth(), navigate = useNavigate(), [params] = useSearchParams();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const access = useQuery({ queryKey: ['clinic-access', auth.user?.id], queryFn: receptionApi.access, enabled: !auth.loading && !!auth.user, retry: false });
  if (auth.loading) return <p role="status">Carregando prévia…</p>;
  if (!auth.user) return <form className="mx-auto max-w-md space-y-4 p-6" onSubmit={async event => {
    event.preventDefault();
    const result = await auth.signIn(email, password);
    if (result.error) { setError('Login sintético recusado.'); return; }
    const permissions = params.get('next') === '/configuracoes-preview?secao=permissoes';
    navigate('/configuracoes-preview?secao=' + (permissions ? 'permissoes' : 'equipe'));
  }}>
    <h1>Prévia sintética</h1>
    <label htmlFor="preview-email">E-mail</label><input id="preview-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} />
    <label htmlFor="preview-password">Senha</label><input id="preview-password" type="password" required value={password} onChange={event => setPassword(event.target.value)} />
    {error && <p role="alert">{error}</p>}
    <button type="submit">Entrar</button>
  </form>;
  if (access.isPending) return <p role="status">Carregando acesso sintético…</p>;
  if (access.isError) return <p role="alert">Não foi possível carregar o acesso sintético.</p>;
  return <ClinicAccessContext.Provider value={access.data}>
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2"><h1 className="text-3xl font-semibold">Configurações</h1><p className="text-sm text-muted-foreground">Prévia sintética de integração — sem conexão externa.</p></header>
      {params.get('secao') === 'permissoes' ? <DelegationPermissions embedded /> : <TeamSettings embedded />}
    </main>
  </ClinicAccessContext.Provider>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><AuthProvider><Preview /></AuthProvider></BrowserRouter></QueryClientProvider>);
