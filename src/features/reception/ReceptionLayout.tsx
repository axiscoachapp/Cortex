import { Link, NavLink, Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from './accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';

export default function ReceptionLayout() {
  const access = useClinicAccess();
  const { signOut } = useAuth();
  return (
    <div className="min-h-full bg-background">
      <header className="border-b bg-card px-4 md:px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/recepcao" aria-label="Haddad Nicola — Recepção">
            <BrandLockup compact />
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Recepção · acesso administrativo</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sair"
              onClick={() => {
                if (confirmSessionExit()) void signOut();
              }}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <nav aria-label="Recepção" className="flex flex-wrap gap-2">
          {[
            { to: '/recepcao', label: 'Fila de atendimento' },
            { to: '/recepcao/agenda', label: 'Agenda da equipe' },
            { to: '/recepcao/contatos', label: 'Contatos' },
            { to: '/configuracoes', label: 'Configurações' },
            ...(access?.admin ? [{ to: '/recepcao/equipe', label: 'Equipe e permissões' }] : []),
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-xs font-medium ${isActive ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {access?.kind === 'clinical' && (
            <Link to="/" className="px-3 py-2 text-xs underline underline-offset-4">
              Ambiente médico
            </Link>
          )}
        </nav>
      </header>
      <main className="p-4 md:p-6 max-w-[100rem] mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
