import { ArrowRight, Check, ConciergeBell, Rocket, Sparkles, Stethoscope } from 'lucide-react';
import { formatBRL, siteConfig } from '../config';
import { CtaBand, PageHero } from '../components/sections';
import { CheckList, Container, Icon, IconTile, SectionHeading, cx } from '../components/ui';

const SOB_PROPOSTA = 'Sob proposta';

export function Pricing() {
  const { pricing } = siteConfig;
  const items = [
    {
      icon: Rocket,
      title: 'Implantação',
      unit: 'valor único',
      price: pricing.implementationFrom !== null ? `a partir de ${formatBRL(pricing.implementationFrom)}` : SOB_PROPOSTA,
      text: 'Diagnóstico, migração com ensaio e conferência, configuração, treinamento e virada acompanhada. Depende do tamanho da clínica e da migração.',
    },
    {
      icon: Stethoscope,
      title: 'Mensalidade por médico',
      unit: 'por médico, por mês',
      price: pricing.perDoctorFrom !== null ? `a partir de ${formatBRL(pricing.perDoctorFrom)}` : SOB_PROPOSTA,
      text: 'Prontuário, consulta com IA, documentos, agenda e pendências para cada médico da clínica.',
    },
    {
      icon: ConciergeBell,
      title: 'Recepção incluída',
      unit: 'na mensalidade',
      price: 'Incluída',
      text: 'A equipe da recepção usa fila de atendimentos, contatos e agenda da clínica sem custo à parte.',
      highlight: true,
    },
    {
      icon: Sparkles,
      title: 'IA com franquia de uso',
      unit: 'franquia mensal',
      price: pricing.aiAllowance ?? SOB_PROPOSTA,
      text: 'Transcrição e rascunhos da consulta dentro de uma franquia mensal, definida na proposta conforme o volume de consultas.',
    },
  ];

  return (
    <>
      <PageHero
        eyebrow="Preços"
        title="Cada clínica recebe uma proposta"
        lead="O valor depende do tamanho da clínica e do histórico a migrar. A estrutura da proposta é sempre a mesma, com quatro partes."
      >
        <div className="mt-8">
          <a href="/contato" className="btn-primary">
            Pedir uma proposta
            <Icon icon={ArrowRight} size={18} />
          </a>
        </div>
      </PageHero>

      <section aria-labelledby="estrutura" className="py-16 md:py-24">
        <Container>
          <h2 id="estrutura" className="sr-only">
            Estrutura da proposta
          </h2>
          <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {items.map((item) => (
              <li
                key={item.title}
                className={cx(
                  'flex flex-col rounded-card border p-6 md:p-7',
                  item.highlight ? 'border-teal-700/30 bg-teal-50' : 'border-line bg-surface',
                )}
              >
                <IconTile icon={item.icon} className={item.highlight ? 'bg-surface' : undefined} />
                <h3 className="mt-5 text-xl xl:min-h-[3.7rem]">{item.title}</h3>
                <p className="mt-4 text-2xl font-extrabold tracking-tight text-ink">{item.price}</p>
                <p className="text-sm font-semibold text-muted">{item.unit}</p>
                <p className="mt-4 border-t border-line pt-4 text-muted">{item.text}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="influencia" className="border-y border-line bg-surface py-16 md:py-24">
        <Container className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading
              id="influencia"
              eyebrow="O que muda o valor"
              title="O que influencia a proposta"
              lead="Levantamos esses pontos no diagnóstico, antes de fechar o valor."
            />
            <CheckList
              className="mt-8"
              items={[
                'Número de médicos da clínica.',
                'Volume e formato do histórico a migrar, e o sistema de origem.',
                'Quantidade de modelos de documentos e de evolução a configurar.',
                'Volume de consultas com IA esperado por mês.',
                'Integrações opcionais, como o Google Agenda.',
                'Número de turmas de treinamento.',
              ]}
            />
          </div>
          <div className="self-start rounded-panel border border-line bg-bg/60 p-7 md:p-9">
            <h2 className="text-2xl md:text-3xl">Em todas as propostas</h2>
            <ul className="mt-6 space-y-4">
              {[
                'Ambiente próprio da clínica, com a marca dela.',
                'Implantação feita pela nossa equipe.',
                'Usuários da recepção sem custo à parte.',
                'Atualizações do sistema e suporte durante o contrato.',
              ].map((t) => (
                <li key={t} className="flex gap-3 text-ink/90">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white">
                    <Icon icon={Check} size={14} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <CtaBand
        title="Peça uma proposta para a sua clínica"
        text="Conte quantos médicos atendem, qual sistema vocês usam e como funciona a recepção. Respondemos com os próximos passos."
        secondary={{ href: '/implantacao', label: 'Como funciona a implantação' }}
      />
    </>
  );
}
