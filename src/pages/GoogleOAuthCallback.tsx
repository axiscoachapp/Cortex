import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

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
      setErrorMsg(error === 'access_denied' ? 'Acesso negado pelo usuário.' : 'Código de autorização não recebido.');
      return;
    }

    if (!user?.id) {
      setStatus('error');
      setErrorMsg('Usuário não autenticado.');
      return;
    }

    const key = `${user.id}/${code}/${state}`;
    if (exchange.current?.key !== key) exchange.current = { key, promise: supabase.functions.invoke('google-oauth-callback', {
        body: {
          code,
          state,
          redirectUri: `${window.location.origin}/google-oauth-callback`,
        },
      }) };
    exchange.current.promise.then(({ data, error: fnError }) => {
        if (!active) return;
        if (fnError || !data || typeof data !== 'object' || !('success' in data) || data.success !== true) {
          setStatus('error');
          setErrorMsg('Não foi possível concluir a conexão. Inicie uma nova conexão pela agenda.');
        } else {
          setStatus('success');
        }
      }).catch(() => { if (active) { setStatus('error'); setErrorMsg('Falha na conexão. Inicie uma nova conexão pela agenda.'); } });
    return () => { active = false; };
  }, [user?.id, loading, location.search]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4" role="status" aria-live="polite">
        {status === 'loading' && (
          <>
            <Loader2 className="w-10 h-10 text-medical-blue animate-spin mx-auto" />
            <p className="text-muted-foreground">Conectando Google Calendar...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
            <p className="font-semibold text-foreground">Google Calendar conectado!</p>
            <button className="rounded border px-4 py-2" onClick={() => navigate('/agenda')}>Abrir agenda</button>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-10 h-10 text-destructive mx-auto" />
            <p className="font-semibold text-foreground">Erro na conexão</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <button className="rounded border px-4 py-2" onClick={() => navigate('/agenda')}>Voltar à agenda</button>
          </>
        )}
      </div>
    </div>
  );
}
