import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PageHeadingProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2;
  id?: string;
  className?: string;
};

/** Shared content hierarchy. The workspace context lives in WorkspaceShell. */
export function PageHeading({ title, description, actions, headingLevel = 1, id, className }: PageHeadingProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0 flex-1 basis-64 space-y-2">
        <Heading id={id} className="text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{title}</Heading>
        {description && <div className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 [&>button]:min-h-11">{actions}</div>}
    </header>
  );
}
