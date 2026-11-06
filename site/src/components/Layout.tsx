import type { ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { siteConfig } from '../config';
import { ArcPattern, Logo } from './Brand';
import { Container, Icon, cx } from './ui';

export const mainNav = [
  { href: '/funcionalidades', label: 'Funcionalidades' },
  { href: '/implantacao', label: 'Implantação' },
  { href: '/seguranca', label: 'Segurança' },
  { href: '/precos', label: 'Preços' },
] as const;

function Header({ current }: { current: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
      <Container className="flex h-16 items-center justify-between gap-4 md:h-[72px]">
        <a href="/" className="-m-1 rounded-md p-1 no-underline" aria-label="Cortex, página inicial">
          <Logo height={30} className="h-[30px] w-auto" />
        </a>

        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {mainNav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={current === item.href ? 'page' : undefined}
                  className={cx(
                    'rounded-full px-3.5 py-2 text-[15px] font-semibold no-underline transition-colors',
                    current === item.href ? 'bg-teal-50 text-teal-800' : 'text-ink/80 hover:bg-white hover:text-ink',
                  )}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <a href="/contato" className="btn-primary hidden !min-h-[40px] !px-4 !py-2 !text-[15px] sm:inline-flex">
            Agendar demonstração
          </a>
          <button
            type="button"
            className="group inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-teal-50 lg:hidden"
            aria-expanded="false"
            aria-controls="menu-movel"
            data-menu-toggle=""
          >
            <span className="sr-only" data-menu-label="">
              Abrir menu
            </span>
            <Icon icon={Menu} size={22} className="group-aria-expanded:hidden" />
            <Icon icon={X} size={22} className="hidden group-aria-expanded:block" />
          </button>
        </div>
      </Container>

      <div id="menu-movel" hidden className="border-t border-line bg-bg lg:hidden" data-menu-panel="">
        <Container className="py-4">
          <nav aria-label="Principal (celular)">
            <ul className="divide-y divide-line">
              {mainNav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={current === item.href ? 'page' : undefined}
                    className={cx(
                      'flex items-center justify-between py-3.5 text-lg font-bold no-underline',
                      current === item.href ? 'text-teal-700' : 'text-ink',
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li className="pt-4">
                <a href="/contato" className="btn-primary w-full">
                  Agendar demonstração
                </a>
              </li>
            </ul>
          </nav>
        </Container>
      </div>
    </header>
  );
}

function Footer() {
  const { companyName, companyCnpj, year } = siteConfig;
  return (
    <footer className="on-ink relative overflow-hidden bg-ink text-muted-ink">
      <ArcPattern className="absolute -right-56 -top-40 h-[640px] w-[640px] text-white/[0.05]" withDot={false} />
      <Container className="relative py-14 md:py-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <Logo inverse height={34} className="h-[34px] w-auto" />
            <p className="mt-5 max-w-sm text-base text-muted-ink">
              Prontuário, consulta com IA revisada pelo médico, documentos, agenda e recepção para clínicas de
              especialidade, com implantação feita pela nossa equipe.
            </p>
          </div>
          <nav aria-label="Rodapé" className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-white">Produto</h2>
              <ul className="mt-4 space-y-2.5">
                {mainNav.map((item) => (
                  <li key={item.href}>
                    <FooterLink href={item.href}>{item.label}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-white">Contato</h2>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <FooterLink href="/contato">Agendar demonstração</FooterLink>
                </li>
                <li>
                  <FooterLink href="/contato#canais">Falar com a equipe</FooterLink>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-white">Legal</h2>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <FooterLink href="/termos">Termos de uso</FooterLink>
                </li>
                <li>
                  <FooterLink href="/privacidade">Política de privacidade</FooterLink>
                </li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-sm text-muted-ink md:flex-row md:items-center md:justify-between">
          {companyName ? (
            <p>
              © {year} {companyName}
              {companyCnpj ? ` · CNPJ ${companyCnpj}` : ''}
            </p>
          ) : null}
          <p>As telas mostradas neste site usam apenas dados fictícios.</p>
        </div>
      </Container>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-[15px] text-muted-ink no-underline transition-colors hover:text-white">
      {children}
    </a>
  );
}

export function SiteShell({ current, children }: { current: string; children: ReactNode }) {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-full bg-ink px-4 py-2 font-bold text-white no-underline focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Pular para o conteúdo
      </a>
      <Header current={current} />
      <main id="conteudo" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Footer />
    </>
  );
}
