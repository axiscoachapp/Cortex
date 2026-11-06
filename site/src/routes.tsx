import type { ComponentType } from 'react';
import { Contact } from './pages/Contact';
import { Features } from './pages/Features';
import { Home } from './pages/Home';
import { Implementation } from './pages/Implementation';
import { Privacy, Terms } from './pages/Legal';
import { NotFound } from './pages/NotFound';
import { Pricing } from './pages/Pricing';
import { Security } from './pages/Security';

export type RouteDef = {
  /** Clean URL served by Vercel (cleanUrls + trailingSlash: false). */
  path: string;
  /** File written inside dist/. */
  file: string;
  title: string;
  description: string;
  Page: ComponentType;
  /** Listed in sitemap.xml and indexable. */
  index: boolean;
};

export const routes: RouteDef[] = [
  {
    path: '/',
    file: 'index.html',
    title: 'Cortex — O prontuário que trabalha junto com o médico',
    description:
      'Prontuário, consulta com IA revisada pelo médico, receitas e pedidos, agenda e recepção num só sistema, com implantação feita pela nossa equipe. Para clínicas de especialidade.',
    Page: Home,
    index: true,
  },
  {
    path: '/funcionalidades',
    file: 'funcionalidades/index.html',
    title: 'Funcionalidades — Cortex',
    description:
      'Consulta com rascunho de evolução por IA, prontuário, receitas (inclusive controle especial C1 e C5), pedidos com TUSS, agenda, recepção, pendências e assistente.',
    Page: Features,
    index: true,
  },
  {
    path: '/implantacao',
    file: 'implantacao/index.html',
    title: 'Implantação — Cortex',
    description:
      'Diagnóstico, migração do histórico com ensaio e conferência, configuração, treinamento e virada acompanhada. O Cortex chega pronto para a clínica usar.',
    Page: Implementation,
    index: true,
  },
  {
    path: '/seguranca',
    file: 'seguranca/index.html',
    title: 'Segurança e privacidade — Cortex',
    description:
      'Segundo fator de autenticação, acesso por papel, recepção sem conteúdo clínico, registro de acessos ao prontuário e IA que só roda quando o médico aciona.',
    Page: Security,
    index: true,
  },
  {
    path: '/precos',
    file: 'precos/index.html',
    title: 'Preços — Cortex',
    description:
      'Cada clínica recebe uma proposta: implantação com valor único, mensalidade por médico, recepção incluída e IA com franquia de uso.',
    Page: Pricing,
    index: true,
  },
  {
    path: '/contato',
    file: 'contato/index.html',
    title: 'Agendar demonstração — Cortex',
    description: 'Peça uma demonstração do Cortex com dados fictícios e converse sobre a migração do sistema da sua clínica.',
    Page: Contact,
    index: true,
  },
  {
    path: '/termos',
    file: 'termos/index.html',
    title: 'Termos de uso do site — Cortex',
    description: 'Termos de uso do site do Cortex.',
    Page: Terms,
    index: true,
  },
  {
    path: '/privacidade',
    file: 'privacidade/index.html',
    title: 'Política de privacidade do site — Cortex',
    description: 'Como o site do Cortex trata dados pessoais: sem cookies, sem ferramentas de análise e sem scripts de terceiros.',
    Page: Privacy,
    index: true,
  },
  {
    path: '/404',
    file: '404.html',
    title: 'Página não encontrada — Cortex',
    description: 'A página que você procurou não existe.',
    Page: NotFound,
    index: false,
  },
];
