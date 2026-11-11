import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FileSignature, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSignatureSession } from '@/hooks/useSignatureSession';

function Row({ icon, title, description, status, action }: {
  icon: React.ReactNode; title: string; description: string; status: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 py-4 first:pt-0 last:pb-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">{icon}</span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{status}{action}</div>
    </div>
  );
}

/** Google Agenda and the digital signature of the signed-in doctor. */
export function ConnectionsSettings({ clinical }: { clinical: boolean }) {
  const { user } = useAuth();
  const google = useQuery({
    queryKey: ['integration-status', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_integration_status', { p_user_id: user!.id }).maybeSingle();
      if (error) throw error;
      return { connected: !!data?.google_connected };
    },
    enabled: !!user?.id && clinical,
    retry: false,
  });
  const signature = useSignatureSession(clinical);
  const [connecting, setConnecting] = useState(false);
  const [googleError, setGoogleError] = useState('');

  const connectGoogle = async () => {
    if (connecting) return;
    setConnecting(true);
    setGoogleError('');
    try {
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { redirectUri: `${window.location.origin}/google-oauth-callback` },
      });
      if (error || !data?.authorizationUrl) throw error ?? new Error('Missing authorization URL');
      const url = new URL(data.authorizationUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('Invalid authorization URL');
      window.location.assign(url.href);
    } catch {
      setGoogleError('Não foi possível iniciar a conexão com o Google. Tente novamente.');
      setConnecting(false);
    }
  };

  if (!clinical) return <p className="text-sm text-muted-foreground">As conexões pessoais são dos médicos. O WhatsApp da clínica fica na seção WhatsApp.</p>;

  const sig = signature.data;
  const sigStatus = signature.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    : !sig || !sig.available || !sig.configured ? <Badge variant="outline">Em preparação</Badge>
    : sig.mfaRequired ? <Badge variant="outline">Ative o segundo fator</Badge>
    : sig.active ? <Badge className="bg-success/15 text-success hover:bg-success/15">Sessão ativa</Badge>
    : <Badge variant="secondary">Disponível</Badge>;

  return (
    <div className="rounded-xl border bg-white p-5 divide-y">
      <Row
        icon={<CalendarDays className="h-5 w-5" />}
        title="Google Agenda"
        description="Copia suas consultas para a sua agenda do Google. Opcional."
        status={google.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          : google.isError ? <Badge variant="outline">Indisponível</Badge>
          : google.data?.connected ? <Badge className="bg-success/15 text-success hover:bg-success/15">Conectado</Badge>
          : <Badge variant="outline">Não conectado</Badge>}
        action={!google.isLoading && !google.data?.connected && !google.isError ? (
          <Button size="sm" variant="outline" onClick={connectGoogle} disabled={connecting}>{connecting ? 'Abrindo…' : 'Conectar'}</Button>
        ) : undefined}
      />
      {googleError && <p role="alert" className="py-2 text-sm text-destructive">{googleError}</p>}
      <Row
        icon={<FileSignature className="h-5 w-5" />}
        title="Assinatura digital ICP-Brasil"
        description={sig && sig.available && sig.configured
          ? 'Assine receitas e documentos com seu certificado em nuvem. A sessão é aberta na tela do documento.'
          : 'Certificado em nuvem (VIDaaS). Fica disponível quando a clínica concluir o credenciamento com o provedor; até lá, imprima e assine à mão.'}
        status={sigStatus}
        action={sig && sig.available && sig.mfaRequired ? <Button size="sm" variant="outline" asChild><Link to="/seguranca">Configurar</Link></Button> : undefined}
      />
    </div>
  );
}
