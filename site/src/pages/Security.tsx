import { Building2, ClipboardCheck, Download, KeyRound, Lock, Share2, ShieldCheck, Sparkles } from 'lucide-react';
import { ArcPattern } from '../components/Brand';
import { CtaBand, PageHero } from '../components/sections';
import { Container, IconTile, SectionHeading } from '../components/ui';

const controls = [
  {
    icon: KeyRound,
    title: 'Segundo fator de autenticação',
    text: 'Além da senha, a entrada pede o código de um aplicativo autenticador no celular.',
  },
  {
    icon: ShieldCheck,
    title: 'Acesso por papel',
    text: 'Médicos, recepção e administração entram com permissões diferentes. Cada pessoa vê o que o seu papel permite.',
  },
  {
    icon: Lock,
    title: 'Recepção sem conteúdo clínico',
    text: 'A recepção trabalha com fila, contatos e agenda. O médico autoriza o que ela pode fazer na agenda dele.',
  },
  {
    icon: ClipboardCheck,
    title: 'Registro de acessos ao prontuário',
    text: 'Fica registrado quem acessou cada prontuário.',
  },
  {
    icon: Share2,
    title: 'Compartilhamento explícito',
    text: 'Um prontuário só é compartilhado com outro médico por uma ação explícita, que pode ser revogada.',
  },
  {
    icon: Download,
    title: 'Exportação e pedido de exclusão',
    text: 'Os dados podem ser exportados, e o pedido de exclusão gera um recibo.',
  },
  {
    icon: Sparkles,
    title: 'IA sob controle do médico',
    text: 'A IA só roda quando o médico aciona, e o que ela gera fica como rascunho até o médico revisar.',
  },
];

export function Security() {
  return (
    <>
      <PageHero
        eyebrow="Segurança e privacidade"
        title="Cada pessoa vê só o que precisa"
        lead="Acesso por papel, segundo fator de autenticação e registro de quem acessou cada prontuário. Abaixo está o que o Cortex faz hoje, sem promessas genéricas."
      />

      <section aria-labelledby="controles" className="py-16 md:py-24">
        <Container>
          <SectionHeading id="controles" eyebrow="Controles" title="O que protege os dados da clínica" />
          <ul className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {controls.map((c) => (
              <li key={c.title} className="card p-6 md:p-7">
                <IconTile icon={c.icon} />
                <h3 className="mt-5 text-xl">{c.title}</h3>
                <p className="mt-2 text-muted">{c.text}</p>
              </li>
            ))}
            <li className="on-ink relative flex flex-col justify-center overflow-hidden rounded-card bg-ink p-6 md:p-8 lg:col-span-2">
              <ArcPattern className="absolute -right-28 top-1/2 h-[380px] w-[380px] -translate-y-1/2 text-white/[0.07]" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xl font-extrabold text-white">A clínica tem um questionário de segurança?</p>
                  <p className="mt-1.5 text-muted-ink">Traga as perguntas para a demonstração.</p>
                </div>
                <a href="/contato" className="btn-signal shrink-0 self-start sm:self-center">
                  Agendar demonstração
                </a>
              </div>
            </li>
          </ul>
        </Container>
      </section>

      <section aria-labelledby="lgpd" className="border-y border-line bg-surface py-16 md:py-24">
        <Container className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <SectionHeading
              id="lgpd"
              eyebrow="LGPD"
              title="Quem é responsável pelo quê"
              lead="A clínica responde pelos dados dos pacientes. O Cortex trata esses dados em nome dela."
            />
          </div>
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-7">
            <li className="card bg-bg/60 p-6">
              <IconTile icon={Building2} />
              <h3 className="mt-5 text-xl">A clínica é a controladora</h3>
              <p className="mt-2 text-muted">
                Decide para que os dados dos pacientes são usados e responde aos pacientes como controladora.
              </p>
            </li>
            <li className="card bg-bg/60 p-6">
              <IconTile icon={ShieldCheck} />
              <h3 className="mt-5 text-xl">O Cortex atua como operador</h3>
              <p className="mt-2 text-muted">
                Trata os dados em nome da clínica e conforme as instruções dela. O contrato de tratamento de dados está
                disponível na contratação.
              </p>
            </li>
          </ul>
        </Container>
      </section>

      <CtaBand
        title="Veja os controles na prática"
        text="Mostramos os controles de acesso, a separação da recepção e o registro de acessos num ambiente com dados fictícios."
        secondary={{ href: '/funcionalidades', label: 'Ver funcionalidades' }}
      />
    </>
  );
}
