import type { ReactNode } from 'react';
import { siteConfig } from '../config';
import { LegalDraftBanner, Placeholder } from '../components/sections';
import { Container, Eyebrow } from '../components/ui';

const UPDATED = '6 de novembro de 2026';

function LegalPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string[];
  children: ReactNode;
}) {
  return (
    <>
      {siteConfig.legalReviewed ? null : <LegalDraftBanner />}
      <section className="border-b border-line bg-gradient-to-b from-teal-50/70 to-bg">
        <Container className="py-12 md:py-16">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-4 text-[2.25rem] leading-[1.12] sm:text-4xl md:text-5xl">{title}</h1>
          <p className="mt-4 text-muted">Última atualização: {UPDATED}.</p>
        </Container>
      </section>
      <Container className="grid grid-cols-1 gap-10 py-12 md:py-16 lg:grid-cols-12 lg:gap-14">
        <aside className="lg:order-2 lg:col-span-4" aria-label="Resumo">
          <div className="card p-6 lg:sticky lg:top-28">
            <p className="text-sm font-bold uppercase tracking-[0.08em] text-teal-700">Em resumo</p>
            <ul className="mt-4 space-y-3">
              {summary.map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-6 text-ink/90">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <div className="prose-legal max-w-prose lg:order-1 lg:col-span-8">{children}</div>
      </Container>
    </>
  );
}

function Company() {
  return <Placeholder value={siteConfig.companyName} label="razão social" />;
}

function Cnpj() {
  return <Placeholder value={siteConfig.companyCnpj} label="CNPJ" />;
}

function PrivacyContact() {
  const email = siteConfig.privacyEmail;
  return email ? <a href={`mailto:${email}`}>{email}</a> : <Placeholder value="" label="e-mail do encarregado" />;
}

export function Terms() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Termos de uso do site"
      summary={[
        'Valem só para este site. A contratação do Cortex tem proposta e contrato próprios.',
        'As telas são ilustrações com dados fictícios.',
        'Recursos “em implantação” ou “em breve” ainda não estão disponíveis.',
        'Aplica-se a lei brasileira.',
      ]}
    >
      <p>
        Estes termos tratam do uso deste site, que apresenta o Cortex, sistema clínico oferecido por <Company />, inscrita no
        CNPJ sob o nº <Cnpj />. A contratação do Cortex por uma clínica segue proposta e contrato próprios, e não estes termos.
      </p>

      <h2>1. Para que serve este site</h2>
      <p>
        O site apresenta o Cortex e o serviço de implantação e permite pedir uma demonstração. As informações têm caráter
        informativo e não constituem oferta. Funcionalidades, prazos e preços valem conforme a proposta e o contrato de cada
        clínica.
      </p>

      <h2>2. Telas e exemplos</h2>
      <p>
        As telas mostradas são ilustrações feitas com dados fictícios, como “Paciente Exemplo” e “Dra. Ana Exemplo”. Elas
        podem ser diferentes da versão atual do sistema. Nenhum dado real de paciente é usado no site nem nas demonstrações.
      </p>

      <h2>3. Recursos em implantação ou em breve</h2>
      <p>
        Recursos marcados como “em implantação” ou “em breve” ainda não estão disponíveis para uso. Não há garantia de data
        para que fiquem disponíveis.
      </p>

      <h2>4. Conteúdo e marcas</h2>
      <p>
        Os textos, o nome e o logotipo do Cortex e as ilustrações deste site não podem ser copiados ou usados sem
        autorização. Nomes de produtos de terceiros citados no site, como PersonalMed, Google Agenda e WhatsApp, pertencem
        aos seus titulares e aparecem só para identificar sistemas e serviços.
      </p>

      <h2>5. Links para outros serviços</h2>
      <p>
        O formulário de contato abre o seu aplicativo de e-mail ou o WhatsApp. Ao usar esses serviços, valem os termos e as
        políticas de quem os oferece.
      </p>

      <h2>6. Limites</h2>
      <p>
        O conteúdo do site não é orientação médica, jurídica ou regulatória. Buscamos manter as informações corretas e
        atualizadas, mas o site pode ficar indisponível ou conter erros, que corrigiremos quando identificados.
      </p>

      <h2>7. Privacidade</h2>
      <p>
        O tratamento de dados pessoais neste site está descrito na <a href="/privacidade">política de privacidade</a>.
      </p>

      <h2>8. Alterações e lei aplicável</h2>
      <p>
        Estes termos podem mudar; a data da última atualização fica no topo da página. Aplica-se a lei brasileira.
      </p>

      <h2>9. Contato</h2>
      <p>
        Dúvidas sobre estes termos: <PrivacyContact />.
      </p>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Política de privacidade do site"
      summary={[
        'Sem cookies, sem ferramentas de análise e sem scripts de terceiros.',
        'O formulário não envia nada: ele abre o seu e-mail ou o WhatsApp.',
        'Usamos os seus dados só para responder ao seu contato.',
        'Você pode exercer os seus direitos da LGPD pelo contato do encarregado.',
      ]}
    >
      <p>
        Esta política explica como tratamos dados pessoais neste site. Ela não trata dos dados de pacientes registrados no
        Cortex pelas clínicas: nesse caso, a clínica é a controladora e o Cortex atua como operador, conforme o contrato de
        tratamento de dados assinado na contratação.
      </p>

      <h2>1. Quem é o controlador</h2>
      <p>
        O controlador dos dados tratados neste site é <Company />, CNPJ <Cnpj />. O contato do encarregado pelo tratamento de
        dados pessoais é <PrivacyContact />.
      </p>

      <h2>2. O que este site não faz</h2>
      <ul>
        <li>Não usa cookies.</li>
        <li>Não usa ferramentas de análise de audiência, pixels de publicidade ou scripts de terceiros.</li>
        <li>Não carrega fontes, imagens ou outros arquivos de outros sites: tudo é servido pelo próprio site.</li>
        <li>Não envia nem guarda o que você digita no formulário de contato.</li>
      </ul>

      <h2>3. Dados que podem ser tratados</h2>
      <h3>Registros técnicos de acesso</h3>
      <p>
        Como em qualquer site, o provedor de hospedagem registra dados técnicos de cada acesso, como endereço IP, data e
        hora, página pedida e navegador. Esses registros servem para entregar as páginas, manter o site seguro e investigar
        falhas, e seguem os prazos de retenção do provedor e da lei.
      </p>
      <h3>Formulário de contato</h3>
      <p>
        O formulário não é enviado a um servidor. Ao clicar em “Pedir demonstração”, o próprio navegador abre o seu
        aplicativo de e-mail ou o WhatsApp com a mensagem pronta. Só recebemos os dados se você enviar a mensagem: nome,
        clínica, cidade, número de médicos, sistema atual, telefone, e-mail e o que você escrever.
      </p>
      <p>
        Usamos esses dados só para responder ao seu pedido e conduzir a conversa comercial, com base em procedimentos
        preliminares a um contrato pedidos por você (art. 7º, V, da LGPD). Guardamos a conversa enquanto ela estiver ativa
        e pelo tempo necessário para cumprir obrigações legais; depois, os dados são excluídos.
      </p>
      <p>
        O WhatsApp e o seu provedor de e-mail são serviços de terceiros, com políticas de privacidade próprias.
      </p>

      <h2>4. Compartilhamento</h2>
      <p>
        Não vendemos dados pessoais. Os dados podem passar pelos fornecedores que usamos para operar o site e o e-mail, e ser
        informados a autoridades quando a lei exigir.
      </p>

      <h2>5. Seus direitos</h2>
      <p>Pela Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode pedir:</p>
      <ul>
        <li>confirmação de que tratamos dados seus e acesso a eles;</li>
        <li>correção de dados incompletos, inexatos ou desatualizados;</li>
        <li>anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade com a lei;</li>
        <li>portabilidade e informação sobre com quem compartilhamos os dados;</li>
        <li>revisão ou oposição a um tratamento, e revogação de consentimento quando ele for a base.</li>
      </ul>
      <p>
        Para exercer esses direitos, escreva para <PrivacyContact />. Você também pode apresentar reclamação à Autoridade
        Nacional de Proteção de Dados (ANPD).
      </p>

      <h2>6. Segurança</h2>
      <p>
        O site é servido por conexão segura (HTTPS), com cabeçalhos de segurança que impedem a execução de scripts de outros
        sites.
      </p>

      <h2>7. Alterações</h2>
      <p>Esta política pode mudar; a data da última atualização fica no topo da página.</p>
    </LegalPage>
  );
}
