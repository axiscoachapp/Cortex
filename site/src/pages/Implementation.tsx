import {
  ClipboardList,
  Database,
  FileStack,
  GraduationCap,
  LifeBuoy,
  Rocket,
  Search,
  Settings2,
  UserRound,
  Users,
} from 'lucide-react';
import { CoBrandingIllustration } from '../components/mockups/Extras';
import { CtaBand, PageHero } from '../components/sections';
import { Container, Icon, IconTile, SectionHeading } from '../components/ui';

const included = [
  {
    icon: Search,
    title: 'Diagnóstico',
    text: 'Conversamos com médicos, recepção e gestão, entendemos o sistema atual e definimos o que migrar e o prazo.',
  },
  {
    icon: Database,
    title: 'Migração com ensaio e conferência',
    text: 'Migramos o histórico num ensaio completo, separado do sistema atual, e a equipe da clínica confere o resultado antes da virada.',
  },
  {
    icon: Settings2,
    title: 'Configuração',
    text: 'Cadastramos médicos e recepção e configuramos os modelos de cada médico, as agendas e as permissões.',
  },
  {
    icon: GraduationCap,
    title: 'Treinamento',
    text: 'Treinamos médicos e recepção nas tarefas do dia a dia, cada grupo no que vai usar.',
  },
  {
    icon: Rocket,
    title: 'Virada acompanhada',
    text: 'No dia em que a clínica passa a usar o Cortex, nossa equipe está junto para resolver o que aparecer.',
  },
  {
    icon: LifeBuoy,
    title: 'Suporte',
    text: 'Acompanhamento de perto nos 30 dias após a virada e suporte durante todo o contrato.',
  },
];

const timeline = [
  { phase: 'Diagnóstico', time: 'cerca de 1 semana', text: 'Rotina da clínica, sistema atual, usuários e modelos.' },
  { phase: 'Migração e ensaio', time: '2 a 3 semanas', text: 'Exportação, ensaio completo e conferência pela clínica.' },
  { phase: 'Configuração e treinamento', time: 'cerca de 1 semana', text: 'Usuários, modelos, permissões e treinamento.' },
  { phase: 'Virada e acompanhamento', time: '30 dias após a virada', text: 'Uso real, com a nossa equipe por perto.' },
];

const clinicProvides = [
  { icon: FileStack, title: 'Exportação do sistema atual', text: 'Ajudamos a pedir ao fornecedor atual o formato certo.' },
  { icon: Users, title: 'Lista de usuários', text: 'Médicos, recepção e administração, com o papel de cada um.' },
  { icon: ClipboardList, title: 'Modelos em uso', text: 'Evoluções, receitas, pedidos e atestados que os médicos já usam.' },
  { icon: UserRound, title: 'Uma pessoa responsável', text: 'Um contato na clínica para decidir e conferir com a gente.' },
];

export function Implementation() {
  return (
    <>
      <PageHero
        eyebrow="Implantação"
        title="O Cortex chega pronto para usar"
        lead="A implantação faz parte do produto. Nossa equipe entende a rotina da clínica, migra o histórico, configura o sistema e acompanha a virada."
      />

      <section aria-labelledby="incluido" className="py-16 md:py-24">
        <Container>
          <SectionHeading id="incluido" eyebrow="O que está incluído" title="Do diagnóstico ao suporte depois da virada" />
          <ul className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {included.map((item) => (
              <li key={item.title} className="card flex gap-4 p-5 sm:block sm:p-6 md:p-7">
                <IconTile icon={item.icon} />
                <div>
                  <h3 className="text-xl sm:mt-5">{item.title}</h3>
                  <p className="mt-1.5 text-muted sm:mt-2">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="prazo" className="border-y border-line bg-surface py-16 md:py-24">
        <Container>
          <SectionHeading
            id="prazo"
            eyebrow="Prazo típico"
            title="Quanto tempo leva"
            lead="Prazo típico, definido no diagnóstico. Clínicas maiores ou com histórico mais complexo podem precisar de mais tempo."
          />
          <ol className="relative mt-12 grid grid-cols-1 gap-8 lg:grid-cols-4 lg:gap-6">
            <span aria-hidden="true" className="absolute left-[19px] top-2 hidden h-[calc(100%-1rem)] w-px bg-line max-lg:block" />
            <span aria-hidden="true" className="absolute left-0 right-0 top-[19px] hidden h-px bg-line lg:block" />
            {timeline.map((t, i) => (
              <li key={t.phase} className="relative flex gap-5 lg:block">
                <span className="tabular relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-extrabold text-white ring-8 ring-surface">
                  {i + 1}
                </span>
                <div className="lg:mt-6">
                  <p className="text-sm font-bold uppercase tracking-[0.06em] text-teal-700">{t.time}</p>
                  <h3 className="mt-1 text-xl">{t.phase}</h3>
                  <p className="mt-1.5 text-muted">{t.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section aria-labelledby="clinica-fornece" className="py-16 md:py-24">
        <Container className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-4">
            <SectionHeading
              id="clinica-fornece"
              eyebrow="Da parte da clínica"
              title="O que pedimos à clínica"
              lead="Pouca coisa, e com a nossa ajuda. O resto fica com a nossa equipe."
            />
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-8">
            {clinicProvides.map((item) => (
              <li key={item.title} className="card flex gap-4 p-5 md:p-6">
                <Icon icon={item.icon} size={22} className="mt-0.5 shrink-0 text-teal-700" />
                <div>
                  <h3 className="text-lg">{item.title}</h3>
                  <p className="mt-1 text-muted">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="marca" className="border-y border-line bg-gradient-to-b from-teal-50/70 to-bg py-16 md:py-24">
        <Container className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <SectionHeading
              id="marca"
              eyebrow="Ambiente da clínica"
              title="Cada clínica com o próprio ambiente e a própria marca"
              lead="Configuramos o ambiente com a identidade da clínica: o logotipo dela vem primeiro, e o Cortex aparece só como “com Cortex”."
            />
            <p className="mt-4 text-muted">
              Em receitas, atestados e pedidos de exame, só a identidade da clínica e do médico.
            </p>
          </div>
          <div className="lg:col-span-7">
            <CoBrandingIllustration />
          </div>
        </Container>
      </section>

      <CtaBand
        title="Vamos começar pelo diagnóstico"
        text="Conte como a sua clínica trabalha hoje e qual sistema usa. Mostramos o Cortex com dados fictícios e explicamos como seria a migração."
        secondary={{ href: '/precos', label: 'Ver como funciona o preço' }}
      />
    </>
  );
}
