import type { ReactNode } from 'react';
import { cx } from '../ui';

/**
 * Browser-like frame for the HTML/CSS product illustrations. The whole frame is
 * decorative (aria-hidden); `description` is what screen readers get instead.
 * All data shown in mockups is fictitious.
 */
export function MockupFrame({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <p className="sr-only">{description}</p>
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-[14px] border border-ink/10 bg-surface text-left text-ink shadow-mock"
      >
        <div className="flex items-center gap-3 border-b border-line bg-[#fbfcfc] px-3.5 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e4e9e8]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e4e9e8]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e4e9e8]" />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <span className="truncate rounded-md bg-bg px-3 py-0.5 text-[11px] font-semibold text-muted ring-1 ring-inset ring-line">
              {title}
            </span>
          </div>
          <span className="w-[42px]" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ initials, tone = 'teal', size = 'md' }: { initials: string; tone?: 'teal' | 'ink' | 'signal' | 'neutral'; size?: 'sm' | 'md' }) {
  const tones = {
    teal: 'bg-teal-100 text-teal-800',
    ink: 'bg-ink text-white',
    signal: 'bg-signal-50 text-signal-700 ring-1 ring-inset ring-signal/40',
    neutral: 'bg-bg text-muted ring-1 ring-inset ring-line',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-[11px]',
        tones[tone],
      )}
    >
      {initials}
    </span>
  );
}
