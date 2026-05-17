import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function GoogleOAuthCallback() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (error || !code) {
      setStatus('error');
      setErrorMsg(error === 'access_denied' ? 'Acesso negado pelo usuário.' : 'Código de autorização não recebido.');
      setTimeout(() => navigate('/agenda'), 3000);
      return;
    }

    if (!user?.id) {
      setStatus('error');
      setErrorMsg('Usuário não autenticado.');
      setTimeout(() => navigate('/auth'), 3000);
      return;
    }

    supabase.functions
      .invoke('google-oauth-callback', {
        body: {
          code,
          userId: user.id,
          redirectUri: `${window.location.origin}/google-oauth-callback`,
        },
      })
      .then(({ error: fnError }) => {
        if (fnError) {
          setStatus('error');
          setErrorMsg(fnError.message || 'Erro ao conectar Google Calendar.');
          setTimeout(() => navigate('/agenda'), 3000);
        } else {
          setStatus('success');
          setTimeout(() => navigate('/agenda?connected=true'), 1500);
        }
      });
  }, [user?.id]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
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
            <p className="text-sm text-muted-foreground">Redirecionando...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-10 h-10 text-destructive mx-auto" />
            <p className="font-semibold text-foreground">Erro na conexão</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <p className="text-xs text-muted-foreground">Redirecionando...</p>
          </>
        )}
      </div>
    </div>
  );
}
