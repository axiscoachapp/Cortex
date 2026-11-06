import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  ConciergeBell,
  Lock,
  MessageCircle,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCheck,
  Users,
} from 'lucide-react';
import { ArcPattern } from '../components/Brand';
import { ConsultationMockup } from '../components/mockups/ConsultationMockup';
import { DelegationCard, MigrationMockup } from '../components/mockups/Extras';
import { ReceptionMockup } from '../components/mockups/ReceptionMockup';
import { CtaBand, Faq, Steps } from '../components/sections';
import { ArrowLink, Badge, CheckList, Container, Icon, IconTile, SectionHeading } from '../components/ui';

const audience = [
  {
    icon: Stethoscope,
    title: 'Clínicas de especialidade',
    text: 'Cada médico com o próprio jeito de escrever a evolução e os próprios modelos de documento.',
  },
  {
    icon: Users,
    title: 'De 2 a 20 médicos',
    text: 'Agenda de cada médico e da clínica inteira, com conflito de horário tratado na hora de marcar.',
  },
  {
    icon: ConciergeBell,
    title: 'Com recepção própria',
    text: 'Uma equipe que agenda, remarca e atende contatos, sem acesso ao conteúdo clínico.',
  },
];

const pillars = [
  {
    icon: Sparkles,
    title: 'Consulta com IA que você revisa',
    text: 'Grave a consulta e receba a transcrição e um rascunho da evolução no seu formato. Nada vai para o prontuário sem a sua revisão.',
    href: '/funcionalidades#consulta',
  },
  {
    icon: ClipboardList,
    title: 'Prontuário e documentos',
    text: 'Histórico por paciente, receitas simples e de controle especial, pedidos de exame com TUSS, atestados e os modelos de cada médico.',
    href: '/funcionalidades#documentos',
  },
  {
    icon: CalendarDays,
    title: 'Recepção e agenda',
    text: 'Fila de atendimentos, contatos e agenda da clínica num só lugar, para a recepção acompanhar cada pedido do começo ao fim.',
    href: '/funcionalidades#recepcao',
  },
  {
    icon: ShieldCheck,
    title: 'Segurança e privacidade',
    text: 'Segundo fator de autenticação, acesso por papel e registro de quem acessou cada prontuário.',
    href: '/seguranca',
  },
];

const faq = [
  {
    q: 'Precisa instalar alguma coisa?',
    a: 'Não. O Cortex funciona no navegador do computador, do tablet e do celular, sem instalar nada.',
  },
  {
    q: 'E os dados do sistema que usamos hoje?',
    a: 'Migramos o histórico do sistema anterior, com um ensaio completo e a conferência da sua equipe antes da virada. O que pode ser trazido depende do que o sistema atual exporta; isso é levantado no diagnóstico.',
  },
  {
    q: 'A IA decide alguma coisa sozinha?',
    a: 'Não. A IA só roda quando o médico aciona. A transcrição, o rascunho da evolução e o resumo pré-consulta chegam como rascunho, e o médico confere, corrige e decide o que salvar.',
  },
  {
    q: 'Quem vê o quê?',
    a: 'Cada pessoa entra com o seu papel. A recepção trabalha com fila, contatos e agenda, sem acesso ao conteúdo clínico, e o médico decide o que ela pode fazer na agenda dele. Compartilhar um prontuário com outro médico é uma ação explícita, que pode ser revogada, e os acessos ao prontuário ficam registrados.',
  },
  {
    q: 'Funciona no celular?',
    a: 'Sim, pelo navegador do celular e do tablet. E se a página fechar no meio da consulta, o rascunho não se perde.',
  },
  {
    q: 'Quanto custa?',
    a: (
      <>
        Cada clínica recebe uma proposta: implantação com valor único, mensalidade por médico, recepção incluída e IA com
        franquia de uso. Veja o que influencia o valor na página de <a href="/precos">preços</a>.
      </>
    ),
  },
  {
    q: 'Tem assinatura digital?',
    a: 'A assinatura digital ICP-Brasil, com certificado em nuvem, está em implantação. Ela entra em uso depois de configurada com o provedor do certificado e testada por um médico. Na proposta, informamos a situação atualizada.',
  },
  {
    q: 'Quanto tempo leva para começar a usar?',
    a: 'O prazo é definido no diagnóstico e depende do tamanho da clínica e do histórico a migrar. Um prazo típico: cerca de 1 semana de diagnóstico, 2 a 3 semanas de migração e ensaio, cerca de 1 semana de configuração e treinamento e 30 dias de acompanhamento depois da virada.',
  },
];

export function Home() {
  return (
    <>
      {/* Hero */}
      <section className="on-ink relative overflow-hidden bg-ink">
        <ArcPattern className="absolute -right-[420px] -top-[300px] h-[1100px] w-[1100px] text-white/[0.05] lg:-right-[260px]" />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0b2229] to-transparent"
        />
        <Container className="relative grid grid-cols-1 items-center gap-12 pb-16 pt-14 md:pb-24 md:pt-20 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <p className="eyebrow">Sistema clínico com implantação incluída</p>
            <h1 className="mt-5 text-[2.5rem] leading-[1.08] text-white sm:text-5xl lg:text-[3.5rem] lg:leading-[1.06]">
              O prontuário que trabalha <span className="text-teal-300">junto com o médico.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-ink md:text-xl md:leading-8">
              O Cortex reúne prontuário, consulta com IA revisada pelo médico, receitas e pedidos, agenda e recepção num só
              sistema. E chega pronto: nossa equipe migra seu histórico, configura seus modelos e treina sua clínica.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href="/contato" className="btn-signal">
                Agendar demonstração
                <Icon icon={ArrowRight} size={18} />
              </a>
              <a href="/funcionalidades" className="btn-ghost-ink">
                Ver funcionalidades
              </a>
            </div>
            <ul className="mt-10 flex flex-col gap-3 text-[15px] text-muted-ink sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2.5">
              {[
                { icon: MonitorSmartphone, text: 'No navegador, sem instalar nada' },
                { icon: Lock, text: 'Segundo fator de autenticação' },
                { icon: UserCheck, text: 'Recepção sem acesso ao conteúdo clínico' },
              ].map((item) => (
                <li key={item.text} className="flex items-center gap-2">
                  <Icon icon={item.icon} size={18} className="shrink-0 text-teal-300" />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-6">
            <ConsultationMockup className="mx-auto max-w-[620px] lg:mr-0" />
          </div>
        </Container>
      </section>

      {/* Audience */}
      <section aria-labelledby="para-quem" className="py-16 md:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <SectionHeading
                id="para-quem"
                eyebrow="Para quem é"
                title="Para clínicas que querem trocar de sistema sem perder o histórico"
                lead="O Cortex foi desenhado para clínicas privadas de especialidade, onde médicos e recepção dividem a mesma agenda e cada médico cuida do próprio prontuário."
              />
            </div>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-7 lg:grid-cols-1 xl:gap-5">
              {audience.map((a) => (
                <li key={a.title} className="card flex items-start gap-4 p-5 sm:flex-col sm:p-6 lg:flex-row lg:gap-5">
                  <IconTile icon={a.icon} />
                  <div>
                    <h3 className="text-xl">{a.title}</h3>
                    <p className="mt-1.5 text-muted">{a.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* Pillars */}
      <section aria-labelledby="pilares" className="border-y border-line bg-surface py-16 md:py-24">
        <Container>
          <SectionHeading
            id="pilares"
            eyebrow="O que o Cortex faz"
            title="Um sistema para a consulta, os documentos e a recepção"
            lead="Médicos e recepção trabalham no mesmo sistema, cada um com as telas e os acessos do seu papel."
          />
          <ul className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {pillars.map((p) => (
              <li key={p.title} className="card group flex flex-col bg-bg/60 p-6 transition-colors hover:border-teal-700/30 hover:bg-teal-50/60">
                <IconTile icon={p.icon} />
                <h3 className="mt-5 text-xl">{p.title}</h3>
                <p className="mt-2 flex-1 text-muted">{p.text}</p>
                <ArrowLink href={p.href} className="mt-5">
                  Saiba mais<span className="sr-only">: {p.title}</span>
                </ArrowLink>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Differentiator: reception separated from clinical content */}
      <section aria-labelledby="recepcao-separada" className="relative overflow-hidden py-16 md:py-24">
        <Container>
          <SectionHeading
            id="recepcao-separada"
            eyebrow="Recepção e médico"
            title="A recepção trabalha separada do conteúdo clínico — e o médico decide o que ela pode fazer na agenda dele."
            className="max-w-4xl"
          />
          <div className="mt-12 grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-14">
            <ul className="space-y-7 lg:col-span-5">
              <li className="flex gap-4">
                <IconTile icon={Lock} />
                <div>
                  <h3 className="text-lg font-bold tracking-normal">A recepção não vê o conteúdo clínico</h3>
                  <p className="mt-1 text-muted">
                    Fila, contatos e agenda ficam com a recepção. Evoluções, receitas e pedidos ficam com quem atende.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <IconTile icon={UserCheck} />
                <div>
                  <h3 className="text-lg font-bold tracking-normal">O médico autoriza</h3>
                  <p className="mt-1 text-muted">
                    A recepção pede para agendar ou remarcar na agenda de um médico, e ele decide se autoriza.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <IconTile icon={ShieldCheck} />
                <div>
                  <h3 className="text-lg font-bold tracking-normal">Cada pessoa com o seu acesso</h3>
                  <p className="mt-1 text-muted">Médicos, recepção e administração entram com permissões diferentes.</p>
                </div>
              </li>
            </ul>
            <div className="relative lg:col-span-7 lg:pb-8">
              <ReceptionMockup />
              <DelegationCard className="relative mx-auto -mt-6 sm:-mt-10 sm:mr-6 lg:absolute lg:-bottom-2 lg:-left-10 lg:m-0" />
            </div>
          </div>
        </Container>
      </section>

      {/* Migration */}
      <section aria-labelledby="historico" className="border-y border-line bg-surface py-16 md:py-24">
        <Container className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="order-2 lg:order-1 lg:col-span-6">
            <MigrationMockup className="mx-auto max-w-[560px]" />
          </div>
          <div className="order-1 lg:order-2 lg:col-span-6">
            <SectionHeading
              id="historico"
              eyebrow="Migração"
              title="Seu histórico vem junto"
              lead="Trazemos o histórico do sistema que a clínica usa hoje, como o PersonalMed. Antes da virada, a migração passa por um ensaio completo e pela conferência da sua equipe."
            />
            <CheckList
              className="mt-8"
              items={[
                'O ensaio roda a migração inteira em um ambiente separado, sem mexer no sistema atual.',
                'Sua equipe confere pacientes, consultas e documentos migrados antes de qualquer mudança.',
                'A virada só acontece depois da conferência.',
                'O que vem do sistema antigo depende do que ele exporta, e é definido no diagnóstico.',
              ]}
            />
          </div>
        </Container>
      </section>

      {/* Implementation */}
      <section aria-labelledby="como-funciona" className="py-16 md:py-24">
        <Container>
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading
              id="como-funciona"
              eyebrow="Implantação"
              title="Como a sua clínica começa a usar"
              lead="A implantação faz parte do produto. Você não configura nada sozinho."
            />
            <ArrowLink href="/implantacao" className="shrink-0">
              Como funciona a implantação
            </ArrowLink>
          </div>
          <Steps
            className="mt-12"
            steps={[
              { title: 'Diagnóstico', text: 'Entendemos a rotina da clínica, o sistema atual e o que precisa vir junto.' },
              { title: 'Migração e ensaio', text: 'Migramos o histórico num ensaio completo, e sua equipe confere o resultado.' },
              {
                title: 'Configuração e treinamento',
                text: 'Cadastramos médicos e recepção, configuramos modelos e permissões e treinamos a equipe.',
              },
              { title: 'Virada acompanhada', text: 'Estamos junto no dia da virada e acompanhamos de perto os primeiros 30 dias.' },
            ]}
          />
        </Container>
      </section>

      {/* WhatsApp teaser */}
      <section aria-labelledby="whatsapp" className="pb-4">
        <Container>
          <div className="relative overflow-hidden rounded-panel border border-line bg-gradient-to-br from-teal-50 to-surface p-7 md:p-10">
            <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-12">
              <div className="md:col-span-8">
                <Badge tone="signal">Em desenvolvimento</Badge>
                <h2 id="whatsapp" className="mt-4 text-2xl md:text-3xl">
                  Em breve: WhatsApp da recepção integrado
                </h2>
                <p className="mt-3 max-w-2xl text-muted">
                  O número da clínica conectado ao WhatsApp oficial, com a caixa de conversas ligada à fila da recepção e
                  mensagens automáticas configuráveis a partir da agenda: lembrete 48 h antes com confirmação, link de
                  pré-consulta e mensagem pós-consulta. Ainda não está disponível.
                </p>
              </div>
              <div aria-hidden="true" className="hidden md:col-span-4 md:block">
                <div className="ml-auto max-w-[260px] space-y-2.5">
                  <div className="flex items-center gap-2 text-teal-700">
                    <Icon icon={MessageCircle} size={20} />
                    <span className="text-sm font-bold">Conversas</span>
                  </div>
                  <span className="block w-4/5 rounded-2xl rounded-tl-md bg-surface px-3.5 py-2.5 text-[13px] leading-snug text-ink/80 shadow-card">
                    Oi! Queria remarcar minha consulta.
                  </span>
                  <span className="ml-auto block w-4/5 rounded-2xl rounded-tr-md bg-teal-700 px-3.5 py-2.5 text-[13px] leading-snug text-white">
                    Claro! Temos quinta às 15h.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section aria-labelledby="perguntas" className="py-16 md:py-24">
        <Container className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-4">
            <SectionHeading
              id="perguntas"
              eyebrow="Perguntas frequentes"
              title="O que as clínicas perguntam"
              lead={
                <>
                  Não achou a sua pergunta? <a href="/contato">Fale com a gente</a>.
                </>
              }
            />
          </div>
          <div className="lg:col-span-8">
            <Faq items={faq} />
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
