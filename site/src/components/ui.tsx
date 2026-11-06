import type { ComponentType, ReactNode } from 'react';
import { ArrowRight, type LucideProps } from 'lucide-react';

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

type IconComponent = ComponentType<LucideProps>;

/** Lucide icon with the brand stroke (1.75) and hidden from assistive tech. */
export function Icon({ icon: I, className, size = 20 }: { icon: IconComponent; className?: string; size?: number }) {
  return <I size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" className={className} />;
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('container-site', className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('eyebrow', className)}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  align = 'left',
  className,
  onInk = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  id?: string;
  align?: 'left' | 'center';
  className?: string;
  onInk?: boolean;
}) {
  return (
    <div className={cx(align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl', className)}>
      {eyebrow ? <Eyebrow className={align === 'center' ? 'justify-center' : undefined}>{eyebrow}</Eyebrow> : null}
      <h2 id={id} className={cx('mt-3 text-3xl md:text-4xl', onInk && 'text-white')}>
        {title}
      </h2>
      {lead ? <p className={cx('mt-4 text-lg', onInk ? 'text-muted-ink' : 'text-muted')}>{lead}</p> : null}
    </div>
  );
}

type BadgeTone = 'teal' | 'signal' | 'neutral' | 'ink';

export function Badge({ children, tone = 'teal', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  const tones: Record<BadgeTone, string> = {
    teal: 'bg-teal-100 text-teal-800',
    signal: 'bg-signal-50 text-signal-700 ring-1 ring-inset ring-signal/40',
    neutral: 'bg-bg text-muted ring-1 ring-inset ring-line',
    ink: 'bg-white/10 text-teal-300 ring-1 ring-inset ring-white/15',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold leading-6',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function IconTile({ icon, className, onInk = false }: { icon: IconComponent; className?: string; onInk?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]',
        onInk ? 'bg-white/10 text-teal-300' : 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100',
        className,
      )}
    >
      <Icon icon={icon} size={22} />
    </span>
  );
}

export function ArrowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={cx('link-arrow', className)}>
      {children}
      <Icon icon={ArrowRight} size={18} />
    </a>
  );
}

export function CheckList({ items, className, onInk = false }: { items: ReactNode[]; className?: string; onInk?: boolean }) {
  return (
    <ul className={cx('space-y-3', className)}>
      {items.map((item, i) => (
        <li key={i} className={cx('flex gap-3', onInk ? 'text-muted-ink' : 'text-ink/90')}>
          <span
            aria-hidden="true"
            className={cx(
              'mt-[0.55rem] h-2 w-2 shrink-0 rounded-full',
              onInk ? 'bg-teal-300' : 'bg-teal-700',
            )}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Screen-reader description for a decorative mockup. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <p className="sr-only">{children}</p>;
}
