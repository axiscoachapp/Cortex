import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { receptionApi } from './api';
import { ClinicAccessContext } from './accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';

export function ClinicAccessGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const exit = () => {
    if (confirmSessionExit()) void signOut();
  };
  const { pathname } = useLocation();
  const access = useQuery({
    queryKey: ['clinic-access', user?.id],
    queryFn: receptionApi.access,
    enabled: !!user,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  if (access.isPending)
    return (
      <div role="status" className="p-8 flex items-center gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Verificando acesso à clínica…
      </div>
    );
  const failure = (
    <div role="alert" className="max-w-lg mx-auto p-6 space-y-4">
      <p>Não foi possível verificar seu acesso à clínica.</p>
      <Button onClick={() => void access.refetch()}>Tentar novamente</Button>
      {access.data && <p className="text-sm">O trabalho aberto está preservado. Verifique o acesso para continuar.</p>}
      <Button variant="ghost" onClick={exit}>
        Sair
      </Button>
    </div>
  );
  if (access.isError && !access.data) return failure;
  const value = access.data;
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
    <ClinicAccessContext.Provider value={value}>
      <div hidden={access.isError}>{children}</div>
      {access.isError && failure}
    </ClinicAccessContext.Provider>
  );
}
