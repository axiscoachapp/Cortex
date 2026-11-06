import type { ReactNode } from 'react';
import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  FileSignature,
  KeyRound,
  ListChecks,
  MessageCircle,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { ConsultationMockup } from '../components/mockups/ConsultationMockup';
import { DocumentMockup } from '../components/mockups/DocumentMockup';
import { TimelineMockup } from '../components/mockups/Extras';
import { ReceptionMockup } from '../components/mockups/ReceptionMockup';
import { CtaBand, PageHero } from '../components/sections';
import { ArrowLink, Badge, CheckList, Container, Eyebrow, Icon, IconTile, cx } from '../components/ui';

const jump = [
  { href: '#consulta', label: 'Consulta' },
  { href: '#prontuario', label: 'Prontuário' },
  { href: '#documentos', label: 'Documentos' },
  { href: '#assinatura', label: 'Assinatura digital' },
  { href: '#agenda', label: 'Agenda' },
  { href: '#recepcao', label: 'Recepção' },
  { href: '#pendencias', label: 'Pendências' },
  { href: '#assistente', label: 'Assistente' },
  { href: '#compartilhamento', label: 'Compartilhamento' },
  { href: '#whatsapp', label: 'WhatsApp' },
  { href: '#seguranca', label: 'Segurança' },
];

function FeatureSection({
  id,
  eyebrow,
  title,
  lead,
  points,
  visual,
  reverse = false,
  tinted = false,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: ReactNode;
  points?: ReactNode[];
  visual: ReactNode;
  reverse?: boolean;
  tinted?: boolean;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className={cx('py-16 md:py-24', tinted && 'border-y border-line bg-surface')}>
      <Container className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-14">
        <div className={cx('lg:col-span-5', reverse && 'lg:order-2')}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id={`${id}-titulo`} className="mt-3 text-3xl md:text-4xl">
            {title}
          </h2>
          <p className="mt-4 text-lg text-muted">{lead}</p>
          {points ? <CheckList className="mt-7" items={points} /> : null}
          {children}
        </div>
        <div className={cx('lg:col-span-7', reverse && 'lg:order-1')}>{visual}</div>
      </Container>
    </section>
  );
}

function SmallFeature({
  id,
  icon,
  title,
  badge,
  children,
}: {
  id: string;
  icon: typeof ListChecks;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article id={id} aria-labelledby={`${id}-titulo`} className="card flex flex-col p-6 md:p-7">
      <div className="flex items-start justify-between gap-3">
        <IconTile icon={icon} />
        {badge}
      </div>
      <h2 id={`${id}-titulo`} className="mt-5 text-2xl">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-muted">{children}</div>
    </article>
  );
}

export function Features() {
  return (
    <>
      <PageHero
        eyebrow="Funcionalidades"
        title="Tudo o que a clínica usa no dia, num só sistema"
        lead="Da consulta à recepção: prontuário, documentos, agenda e atendimento no mesmo lugar, com cada pessoa vendo só o que o seu papel permite."
      >
        <nav aria-label="Nesta página" className="mt-8">
          <ul className="flex flex-wrap gap-2">
            {jump.map((j) => (
              <li key={j.href}>
                <a
                  href={j.href}
                  className="inline-flex rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink no-underline transition-colors hover:border-teal-700/40 hover:bg-teal-50"
                >
                  {j.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHero>

      <FeatureSection
        id="consulta"
        eyebrow="Consulta"
        title="A IA prepara o rascunho. Você revisa e salva."
        lead="Grave a consulta pelo navegador. A IA prepara a transcrição e um rascunho da evolução no formato que você usa."
        points={[
          'O texto chega como rascunho, para você conferir e corrigir. Nada entra no prontuário sem a sua revisão.',
          'Antes da consulta, um resumo do histórico e sugestões de perguntas, gerados por IA para a sua conferência.',
          'A IA só roda quando você aciona.',
          'Se a página fechar no meio da consulta, o rascunho não se perde.',
        ]}
        visual={<ConsultationMockup />}
      />

      <FeatureSection
        id="prontuario"
        eyebrow="Prontuário"
        title="O histórico do paciente numa linha do tempo"
        lead="Cada paciente tem um histórico único, que cresce consulta a consulta."
        points={[
          'Consultas e evoluções em ordem de data, com quem atendeu.',
          'Alergias e medicações em uso sempre à vista.',
          'Arquivos e exames anexados ao prontuário.',
        ]}
        visual={<TimelineMockup className="mx-auto max-w-[620px]" />}
        reverse
        tinted
      />

      <FeatureSection
        id="documentos"
        eyebrow="Documentos e prescrição"
        title="Receitas, pedidos e atestados no seu modelo"
        lead="Documentos com a identidade da clínica e do médico, a partir dos modelos que cada um já usa."
        points={[
          'Receita simples e receita de controle especial das listas C1 e C5. As listas A e B continuam no talão numerado.',
          'Pedidos de exame com busca na tabela TUSS, pelo nome ou pelo começo do código.',
          'Atestados e orientações, com CID-10 quando o paciente pede.',
          'Medicamentos pela DCB e pela lista da CMED.',
          'Modelos do próprio médico, para não começar cada documento do zero.',
        ]}
        visual={<DocumentMockup className="mx-auto max-w-[560px]" />}
      />

      {/* Signature */}
      <section id="assinatura" aria-labelledby="assinatura-titulo" className="pb-16 md:pb-24">
        <Container>
          <div className="flex flex-col gap-6 rounded-panel border border-line bg-surface p-7 md:flex-row md:items-center md:gap-8 md:p-10">
            <IconTile icon={FileSignature} className="md:h-14 md:w-14" />
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="assinatura-titulo" className="text-2xl md:text-3xl">
                  Assinatura digital ICP-Brasil
                </h2>
                <Badge tone="signal">Em implantação</Badge>
              </div>
              <p className="mt-3 text-muted">
                Assinatura dos documentos com certificado ICP-Brasil em nuvem. O recurso está em
                implantação: entra em uso depois de configurado com o provedor do certificado e testado por um médico.
              </p>
            </div>
            <ArrowLink href="/contato" className="shrink-0">
              Perguntar a situação
            </ArrowLink>
          </div>
        </Container>
      </section>

      {/* Agenda + reception */}
      <section aria-labelledby="agenda-titulo" className="border-y border-line bg-surface py-16 md:py-24">
        <Container className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="space-y-12 lg:col-span-5">
            <div id="agenda">
              <Eyebrow>Agenda</Eyebrow>
              <h2 id="agenda-titulo" className="mt-3 text-3xl md:text-4xl">
                Agenda de cada médico e da clínica
              </h2>
              <p className="mt-4 text-lg text-muted">
                Cada médico vê a própria agenda; a clínica vê o dia inteiro. Conflitos de horário são tratados na hora de
                marcar.
              </p>
              <p className="mt-4 flex flex-wrap items-center gap-2 text-ink/90">
                <Icon icon={CalendarDays} size={18} className="text-teal-700" />
                Sincronização com o Google Agenda
                <Badge tone="neutral">Opcional</Badge>
              </p>
            </div>
            <div id="recepcao">
              <Eyebrow>Recepção</Eyebrow>
              <h2 className="mt-3 text-3xl md:text-4xl">Fila de atendimentos, contatos e equipe</h2>
              <CheckList
                className="mt-6"
                items={[
                  'Fila de atendimentos com status e a pessoa responsável por cada pedido.',
                  'Contatos da clínica e agenda de todos os médicos num só lugar.',
                  'Equipe da recepção cadastrada, cada pessoa com o seu acesso.',
                  'A recepção não vê o conteúdo clínico, e o médico autoriza o que ela pode fazer na agenda dele.',
                ]}
              />
            </div>
          </div>
          <div className="lg:col-span-7">
            <ReceptionMockup />
          </div>
        </Container>
      </section>

      {/* Smaller features */}
      <section aria-label="Outros recursos" className="py-16 md:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <SmallFeature id="pendencias" icon={ListChecks} title="Pendências">
              <p>
                Lista de tarefas clínicas por paciente: o que ficou para depois da consulta fica anotado e à vista de quem
                atende.
              </p>
            </SmallFeature>
            <SmallFeature id="assistente" icon={BookOpen} title="Assistente e base de conhecimento">
              <p>Pergunte sobre o prontuário e veja de onde veio cada resposta.</p>
              <p>A IA também consulta a base de protocolos da própria clínica.</p>
            </SmallFeature>
            <SmallFeature id="compartilhamento" icon={Share2} title="Compartilhamento entre médicos">
              <p>
                Compartilhe um prontuário com outro médico por uma ação explícita. O compartilhamento pode ser revogado.
              </p>
            </SmallFeature>
          </div>

          {/* WhatsApp */}
          <div
            id="whatsapp"
            className="mt-5 flex flex-col gap-6 rounded-panel border border-line bg-gradient-to-br from-teal-50 to-surface p-7 md:flex-row md:items-center md:gap-8 md:p-10"
          >
            <IconTile icon={MessageCircle} className="md:h-14 md:w-14" />
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl md:text-3xl">WhatsApp da recepção</h2>
                <Badge tone="signal">Em breve</Badge>
              </div>
              <p className="mt-3 max-w-3xl text-muted">
                Em desenvolvimento: o número da clínica conectado ao WhatsApp oficial, com caixa de conversas ligada à fila de
                atendimentos, responsável por conversa e acompanhamento da recepção. Mensagens automáticas configuráveis pela
                agenda: lembrete antes da consulta com botão de confirmação, link de pré-consulta e mensagem pós-consulta, só
                em horário comercial e respeitando quem pediu para não receber. Ainda não está disponível.
              </p>
            </div>
          </div>

          {/* Security summary */}
          <div id="seguranca" className="on-ink mt-5 rounded-panel bg-ink p-7 md:p-10">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-12 md:items-center">
              <div className="md:col-span-5">
                <h2 className="text-2xl text-white md:text-3xl">Segurança</h2>
                <p className="mt-3 text-muted-ink">Controles que valem para todos os usuários da clínica.</p>
                <a href="/seguranca" className="btn-ghost-ink mt-6">
                  Segurança e privacidade
                </a>
              </div>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:col-span-7">
                {[
                  { icon: KeyRound, text: 'Segundo fator de autenticação por aplicativo' },
                  { icon: ShieldCheck, text: 'Acesso por papel: médico, recepção e administração' },
                  { icon: ClipboardCheck, text: 'Registro de quem acessou cada prontuário' },
                ].map((item) => (
                  <li key={item.text} className="rounded-card bg-white/[0.06] p-5 ring-1 ring-inset ring-white/10">
                    <Icon icon={item.icon} size={22} className="text-teal-300" />
                    <p className="mt-3 text-[15px] font-semibold text-white">{item.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
