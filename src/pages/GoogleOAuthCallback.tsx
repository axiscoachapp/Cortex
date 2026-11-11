import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/BrandLockup';

export default function GoogleOAuthCallback() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const location = useLocation();
  const exchange = useRef<{ key: string; promise: ReturnType<typeof supabase.functions.invoke> } | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (loading) return;
    let active = true;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error || !code || !state) {
      setStatus('error');
      setErrorMsg(error === 'access_denied'
        ? 'Você não autorizou o acesso à agenda do Google. Se quiser conectar, volte à agenda e toque em Conectar Google de novo.'
        : 'A conexão não foi concluída. Volte à agenda e toque em Conectar Google de novo.');
      return;
    }

    if (!user?.id) {
      setStatus('error');
      setErrorMsg('Entre no Cortex e toque em Conectar Google de novo, na agenda.');
      return;
    }

    const key = `${user.id}/${code}/${state}`;
    if (exchange.current?.key !== key)
      exchange.current = {
        key,
        promise: supabase.functions.invoke('google-oauth-callback', {
          body: {
            code,
            state,
            redirectUri: `${window.location.origin}/google-oauth-callback`,
          },
        }),
      };
    exchange.current.promise
      .then(({ data, error: fnError }) => {
        if (!active) return;
        if (fnError || !data || typeof data !== 'object' || !('success' in data) || data.success !== true) {
          setStatus('error');
          setErrorMsg('A conexão não foi concluída. Volte à agenda e toque em Conectar Google de novo.');
        } else {
          setStatus('success');
        }
      })
      .catch(() => {
        if (active) {
          setStatus('error');
          setErrorMsg('A conexão não foi concluída. Volte à agenda e toque em Conectar Google de novo.');
        }
      });
    return () => {
      active = false;
    };
  }, [user?.id, loading, location.search]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4 md:p-6">
      <section className="w-full max-w-lg rounded-xl border bg-card p-5 text-center space-y-5 md:p-8">
        <BrandLockup compact className="mx-auto w-fit" />
        <h1 className="text-xl font-semibold tracking-tight">Conectar agenda do Google</h1>
        <div className="space-y-4" role="status" aria-live="polite">
          {status === 'loading' && (
            <>
              <Loader2 className="w-10 h-10 text-medical-blue animate-spin mx-auto" />
              <p className="text-muted-foreground">Conectando a agenda do Google…</p>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
              <p className="font-semibold text-foreground">Agenda do Google conectada.</p>
              <Button onClick={() => navigate('/agenda')}>Abrir agenda</Button>
            </>
          )}
          {status === 'error' && (
            <>
              <XCircle className="w-10 h-10 text-destructive mx-auto" />
              <p className="font-semibold text-foreground">Não foi possível conectar</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{errorMsg}</p>
              <Button variant="outline" onClick={() => navigate('/agenda')}>
                Voltar à agenda
              </Button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
