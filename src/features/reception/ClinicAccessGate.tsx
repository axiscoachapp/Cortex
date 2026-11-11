import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, matchRoutes, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { receptionApi } from './api';
import { ClinicAccessContext } from './accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { ClinicAccessTransportError } from './accessErrors';
import type { ClinicAccess } from './contracts';
import { SessionPausedContext, SessionVisibilityContext } from '@/contexts/SessionVisibility';
import { useGraceExpired, VERIFICATION_RETRIES, VERIFICATION_RETRY_DELAY_MS } from '@/hooks/useVerificationGrace';

export function ClinicAccessGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const exit = () => {
    if (confirmSessionExit()) void signOut();
  };
  const { pathname, search, key: locationKey } = useLocation();
  // Follow the router's decoding, case and trailing-slash rules. Comparing the
  // raw pathname would miss aliases that still mount the Settings route.
  const receptionPage = matchRoutes([{ path: '/recepcao/*' }], pathname) !== null;
  const settingsPage = matchRoutes([{ path: '/configuracoes' }], pathname) !== null;
  const parentHidden = useContext(SessionVisibilityContext);
  const parentPaused = useContext(SessionPausedContext);
  const workspace = useRef<HTMLDivElement>(null);
  const verified = useRef<{ access: ClinicAccess; locationKey: string } | null>(null);
  const retryable = useRef({ settingsPage, actor: user?.id });
  retryable.current = { settingsPage, actor: user?.id };
  const access = useQuery({
    queryKey: ['clinic-access', user?.id],
    queryFn: async () => {
      try {
        const value = await receptionApi.access();
        return value.actorId === user?.id ? value : null;
      } catch (error) {
        if (error instanceof ClinicAccessTransportError) throw error;
        // Replace the cached role on a definitive/unknown failure. A later
        // transport error must not revive it, including after gate remount.
        return null;
      }
    },
    enabled: !!user,
    // Retry a transport failure quickly when this actor was already verified
    // here. Settings keep the strict rule: the first failure unmounts them.
    retry: (count, error) => count < VERIFICATION_RETRIES && error instanceof ClinicAccessTransportError
      && !retryable.current.settingsPage && !!verified.current && verified.current.access.actorId === retryable.current.actor,
    retryDelay: VERIFICATION_RETRY_DELAY_MS,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    networkMode: 'always',
  });
  const current = user && access.data?.actorId === user.id ? access.data : null;
  const fresh = access.isSuccess && access.isFetchedAfterMount && !!current;
  useEffect(() => {
    if (fresh && current) verified.current = { access: current, locationKey };
  }, [fresh, current, locationKey]);
  const retained = workspace.current && verified.current && verified.current.access.actorId === user?.id && verified.current.locationKey === locationKey
    ? verified.current.access : null;
  // A transport failure after a verified read keeps the last verified access on
  // the same page (never Settings). Clinical pages continue as before; every
  // other page (reception included) for VERIFICATION_GRACE_MS, then blocks.
  const transportFailure = access.isError && access.error instanceof ClinicAccessTransportError;
  const mayContinue = !!retained && !!current && !settingsPage && transportFailure;
  const clinicalPage = !!current && current.kind === 'clinical' && !receptionPage;
  const graceExpired = useGraceExpired(mayContinue && !clinicalPage, user?.id ?? null);
  const continueClinical = mayContinue && (clinicalPage || !graceExpired);
  const blocked = !fresh && !continueClinical;
  // Paused: retrying or continuing on the last verified access. Keep local
  // state; dialogs disable their submit actions until a verified read.
  const paused = parentPaused || (!blocked && (continueClinical || access.failureCount > 0));
  const value = current ?? retained;
  if (access.isPending || !access.isFetchedAfterMount)
    return (
      <div role="status" className="p-8 flex items-center gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Verificando acesso à clínica…
      </div>
    );
  const failure = (
    <Dialog open={!parentHidden}>
      <DialogContent role="alertdialog" data-clinic-access-blocked data-clinic-access-recovery className="inset-0 left-0 top-0 z-[110] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-background p-6 sm:rounded-none [&>button]:hidden" onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
      <div role="alert" className="max-w-lg mx-auto w-full self-start space-y-4">
      <DialogTitle>Verificação de acesso</DialogTitle>
      <DialogDescription>Atualize a verificação para continuar com segurança.</DialogDescription>
      <p>Não foi possível verificar seu acesso à clínica.</p>
      <Button onClick={() => void access.refetch()}>Tentar novamente</Button>
      {retained && <p className="text-sm">{settingsPage ? 'Verifique seu acesso para reabrir as configurações.' : 'O trabalho aberto está preservado. Verifique o acesso para continuar.'}</p>}
      <Button variant="ghost" onClick={exit}>
        Sair
      </Button>
      </div>
      </DialogContent>
    </Dialog>
  );
  // Settings can contain credentials and administrative portals outside the
  // page wrapper. Unmount them on failed verification, including their portals.
  if (!value || (blocked && (!retained || settingsPage))) return failure;
  const accountPage = ['/seguranca', '/privacidade'].includes(pathname);
  if (value.kind === 'reception') {
    if (!accountPage && (!value.active || !value.clinic || !value.doctors.length))
      return (
        <div className="max-w-lg mx-auto p-6 space-y-4">
          <h1 className="text-lg font-semibold">Acesso de recepção indisponível</h1>
          <p className="text-sm text-muted-foreground">
            Peça ao administrador para ativar sua conta e delegar as agendas necessárias.
          </p>
          <Link className="text-sm underline" to="/seguranca">
            Segurança da conta
          </Link>
          <Button variant="outline" onClick={exit}>
            Sair
          </Button>
        </div>
      );
    if (!accountPage && !settingsPage && !receptionPage) {
      const params=new URLSearchParams(search);
      const scheduling=matchRoutes([{path:'/trabalho'}],pathname)!==null&&!params.get('patient')&&params.get('queue')==='scheduling';
      return <Navigate to={scheduling?'/recepcao/agenda':'/recepcao'} replace />;
    }
  } else if (receptionPage && (!value.clinic || !value.active || !value.admin)) {
    return (
      <div className="max-w-lg mx-auto p-6 space-y-4">
        <h1 className="text-lg font-semibold">Área da recepção</h1>
        <p className="text-sm text-muted-foreground">
          Disponível para a equipe de recepção e a administração de uma clínica ativa.
        </p>
        <Link className="text-sm underline" to={value.clinic ? '/' : '/compartilhamento'}>
          {value.clinic ? 'Voltar ao ambiente médico' : 'Configurar clínica'}
        </Link>
      </div>
    );
  }
  return (
    <SessionVisibilityContext.Provider value={parentHidden || blocked}>
      <SessionPausedContext.Provider value={paused}>
      <ClinicAccessContext.Provider value={value}>
        <div className={continueClinical ? 'clinic-access-continued' : undefined}>
          {continueClinical && (
            <div role="status" aria-label="Estado da conexão com a clínica" className="shrink-0 border-b border-border bg-muted px-4 py-3 text-sm">
              <p>Não foi possível atualizar o acesso à clínica. O atendimento permanece aberto.</p>
              <Button className="mt-2 h-auto min-h-9 max-w-full whitespace-normal" size="sm" variant="outline" disabled={access.isFetching} onClick={() => void access.refetch()}>
                Verificar acesso novamente
              </Button>
            </div>
          )}
          <div key="workspace" ref={workspace} data-clinic-page hidden={blocked}>{children}</div>
        </div>
        {blocked && failure}
      </ClinicAccessContext.Provider>
      </SessionPausedContext.Provider>
    </SessionVisibilityContext.Provider>
  );
}
