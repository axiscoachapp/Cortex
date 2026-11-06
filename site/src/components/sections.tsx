import type { ReactNode } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { ArcPattern } from './Brand';
import { Container, Eyebrow, Icon, cx } from './ui';

export function PageHero({
  eyebrow,
  title,
  lead,
  children,
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-teal-50/70 to-bg">
      <ArcPattern
        className="absolute -right-48 -top-56 hidden h-[760px] w-[760px] text-teal-700/[0.07] md:block"
        withDot={false}
      />
      <Container className="relative py-14 md:py-20">
        <div className={cx(aside ? 'grid grid-cols-1 items-center gap-12 lg:grid-cols-12' : 'max-w-3xl')}>
          <div className={aside ? 'lg:col-span-7' : undefined}>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="mt-4 text-[2.25rem] leading-[1.12] sm:text-4xl md:text-5xl">{title}</h1>
            <p className="mt-5 max-w-2xl text-lg text-muted md:text-xl md:leading-8">{lead}</p>
            {children}
          </div>
          {aside ? <div className="lg:col-span-5">{aside}</div> : null}
        </div>
      </Container>
    </section>
  );
}

export function CtaBand({
  title = 'Veja o Cortex funcionando com dados de exemplo',
  text = 'Na demonstração, mostramos a consulta, os documentos e a recepção com dados fictícios e conversamos sobre a migração do seu sistema atual.',
  secondary = { href: '/implantacao', label: 'Como funciona a implantação' },
}: {
  title?: string;
  text?: string;
  secondary?: { href: string; label: string } | null;
}) {
  return (
    <section aria-labelledby="cta-final" className="py-16 md:py-24">
      <Container>
        <div className="on-ink relative overflow-hidden rounded-panel bg-ink px-6 py-12 sm:px-10 md:px-14 md:py-16">
          <ArcPattern className="absolute -right-40 top-1/2 h-[620px] w-[620px] -translate-y-1/2 text-white/[0.07]" />
          <div className="relative max-w-2xl">
            <h2 id="cta-final" className="text-3xl text-white md:text-4xl">
              {title}
            </h2>
            <p className="mt-4 text-lg text-muted-ink">{text}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a href="/contato" className="btn-signal">
                Agendar demonstração
                <Icon icon={ArrowRight} size={18} />
              </a>
              {secondary ? (
                <a href={secondary.href} className="btn-ghost-ink">
                  {secondary.label}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function Faq({ items }: { items: Array<{ q: string; a: ReactNode }> }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left text-lg font-bold text-ink transition-colors hover:bg-bg md:px-6 md:py-5">
            <span>{item.q}</span>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 transition-transform duration-200 group-open:rotate-180">
              <Icon icon={ChevronDown} size={18} />
            </span>
          </summary>
          <div className="px-5 pb-5 text-base leading-7 text-ink/85 md:px-6 md:pb-6">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

/** Numbered steps used by the home page and the implementation page. */
export function Steps({
  steps,
  className,
}: {
  steps: Array<{ title: string; text: ReactNode; meta?: string }>;
  className?: string;
}) {
  return (
    <ol className={cx('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {steps.map((s, i) => (
        <li key={s.title} className="card relative flex flex-col p-6">
          <div className="flex items-center justify-between">
            <span className="tabular inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-extrabold text-white">
              {i + 1}
            </span>
            {s.meta ? <span className="text-sm font-bold text-teal-700">{s.meta}</span> : null}
          </div>
          <h3 className="mt-5 text-xl">{s.title}</h3>
          <p className="mt-2 text-base text-muted">{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function LegalDraftBanner() {
  return (
    <div className="border-b border-signal/40 bg-signal-50" role="note">
      <Container className="py-3 text-sm font-semibold text-signal-700">
        Versão preliminar — em revisão jurídica. Este texto pode mudar antes da versão final.
      </Container>
    </div>
  );
}

/** Highlights a value that still has to be filled in config (company name, CNPJ…). */
export function Placeholder({ value, label }: { value: string; label: string }) {
  return value ? (
    <>{value}</>
  ) : (
    <span className="rounded bg-signal-50 px-1 font-semibold text-signal-700">[{label}]</span>
  );
}
