import { ArrowRight } from 'lucide-react';
import { ArcPattern } from '../components/Brand';
import { mainNav } from '../components/Layout';
import { Container, Eyebrow, Icon } from '../components/ui';

export function NotFound() {
  return (
    <section className="relative overflow-hidden">
      <ArcPattern className="absolute -right-56 top-1/2 hidden h-[720px] w-[720px] -translate-y-1/2 text-teal-700/[0.08] md:block" />
      <Container className="relative py-20 md:py-28">
        <Eyebrow>Erro 404</Eyebrow>
        <h1 className="mt-4 max-w-2xl text-4xl md:text-5xl">Não encontramos esta página</h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          O endereço pode ter mudado ou estar digitado errado. Estes caminhos podem ajudar:
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href="/" className="btn-primary">
            Ir para o início
            <Icon icon={ArrowRight} size={18} />
          </a>
          <a href="/contato" className="btn-secondary">
            Agendar demonstração
          </a>
        </div>
        <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
          {mainNav.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="font-semibold">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
