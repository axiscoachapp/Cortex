// Return from the PSC authorization (SIGNATURE_PSC_REDIRECT_URI points here):
// the single-use code and state go to signature-session/complete, which
// checks the CPF and the certificate before opening the session.
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/BrandLockup';
import { SESSION_KEY, signatureInvoke } from '@/hooks/useSignatureSession';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { RETURN_KEY, completeSession } from '@/lib/signatureClient';

/** Only a path of this app (never another origin) to go back to. */
function returnPath(): string {
  try {
    const saved = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    if (saved && saved.startsWith('/') && !saved.startsWith('//') && !saved.startsWith('/assinatura/retorno'))
      return saved;
  } catch {
    /* storage blocked */
  }
  return '/';
}

export default function SignatureReturn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const handled = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    if (error || !code || !state) {
      setStatus('error');
      setMessage(
        error === 'access_denied'
          ? 'A assinatura foi negada no aplicativo do certificado. Volte e abra a sessão de assinatura de novo.'
          : 'A sessão de assinatura não foi aberta. Volte e tente de novo.',
      );
      return;
    }
    if (!user) {
      setStatus('error');
      setMessage('Entre no Cortex e abra a sessão de assinatura de novo.');
      return;
    }
    // The code is single use: one request per code, also under StrictMode.
    const key = `${user.id}/${state}`;
    if (handled.current === key) return;
    handled.current = key;
    completeSession(signatureInvoke, code, state).then(
      async (result) => {
        if ('message' in result) {
          setStatus('error');
          setMessage(result.message);
          return;
        }
        await queryClient.invalidateQueries({ queryKey: [SESSION_KEY] });
        const until = result.expiresAt
          ? new Date(result.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : '';
        toast({ title: 'Sessão de assinatura aberta', description: until ? `Válida até ${until}.` : undefined });
        navigate(returnPath(), { replace: true });
      },
      () => {
        setStatus('error');
        setMessage('A sessão de assinatura não foi aberta. Volte e tente de novo.');
      },
    );
  }, [loading, user, location.search, navigate, queryClient, toast]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4 md:p-6">
      <section className="w-full max-w-lg rounded-xl border bg-card p-5 text-center space-y-5 md:p-8">
        <BrandLockup compact className="mx-auto w-fit" />
        <h1 className="text-xl font-semibold tracking-tight">Autorização de assinatura</h1>
        {status === 'loading' ? (
          <>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-medical-blue" aria-hidden />
            <p role="status" className="text-sm text-muted-foreground">
              Abrindo a sessão de assinatura…
            </p>
          </>
        ) : (
          <>
            <XCircle className="w-6 h-6 mx-auto text-destructive" aria-hidden />
            <p role="alert" className="text-sm text-foreground">
              {message}
            </p>
            <Button variant="outline" onClick={() => navigate(returnPath(), { replace: true })}>
              Voltar
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
