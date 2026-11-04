import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { receptionApi } from './api';
import { ClinicAccessContext } from './accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { ClinicAccessTransportError } from './accessErrors';
import type { ClinicAccess } from './contracts';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';

export function ClinicAccessGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const exit = () => {
    if (confirmSessionExit()) void signOut();
  };
  const { pathname, key: locationKey } = useLocation();
  const parentHidden = useContext(SessionVisibilityContext);
  const workspace = useRef<HTMLDivElement>(null);
  const verified = useRef<{ access: ClinicAccess; locationKey: string } | null>(null);
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
    retry: false,
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
  const continueClinical = !!retained && !!current && current.kind === 'clinical' && !pathname.startsWith('/recepcao')
    && access.isError && access.error instanceof ClinicAccessTransportError;
  const blocked = !fresh && !continueClinical;
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
      {retained && <p className="text-sm">O trabalho aberto está preservado. Verifique o acesso para continuar.</p>}
      <Button variant="ghost" onClick={exit}>
        Sair
      </Button>
      </div>
      </DialogContent>
    </Dialog>
  );
  if (!value || (blocked && !retained)) return failure;
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
    if (!accountPage && !pathname.startsWith('/recepcao')) return <Navigate to="/recepcao" replace />;
  } else if (pathname.startsWith('/recepcao') && (!value.clinic || !value.active || !value.admin)) {
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
    </SessionVisibilityContext.Provider>
  );
}
