import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppSidebar, useAppNavigation } from '@/components/AppNavigation';
import { BrandLockup } from '@/components/BrandLockup';
import { cn } from '@/lib/utils';

type WorkspaceShellProps = {
  children: ReactNode;
  section: string;
  contentClassName?: string;
  shellClassName?: string;
};

/** Navigation and presentation only; mounts no clinical readers or authorization. */
export function WorkspaceShell({ children, section, contentClassName, shellClassName }: WorkspaceShellProps) {
  const { access, home, workspace } = useAppNavigation();
  return (
    <div className={cn('min-h-screen bg-background shell:flex', shellClassName)}>
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <header className="border-b bg-card">
          <div className="mx-auto flex min-h-14 max-w-[100rem] items-center justify-between gap-x-4 gap-y-2 px-4 py-2 md:px-6 shell:min-h-12 shell:py-2 xl:min-h-16 xl:px-8 xl:py-3">
            <div className="hidden min-w-0 items-center gap-2 text-xs shell:flex">
              {workspace?.label !== section && <><span className="text-muted-foreground">{workspace?.label ?? 'Sua conta'}</span><span className="text-border" aria-hidden="true">/</span></>}<span className="font-medium [overflow-wrap:anywhere]">{section}</span>
            </div>
            {/* Phone: the clinic's mark leads home; areas, account and "Sair" live in "Mais". */}
            <Link to={home} aria-label={`${access?.clinic?.name ?? 'Cortex'} — Início`} className="flex min-h-11 min-w-0 items-center rounded-lg shell:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <BrandLockup compact className="[&_img]:w-28 [&_p]:hidden" />
            </Link>
            {access?.clinic?.name && <p className="min-w-0 text-right text-xs text-muted-foreground [overflow-wrap:anywhere]">{access.clinic.name}</p>}
          </div>
        </header>
        <main className={cn('mx-auto w-full min-w-0 max-w-[100rem] space-y-6 p-4 md:p-6 xl:p-8', contentClassName)}>{children}</main>
      </div>
    </div>
  );
}
