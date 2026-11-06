# Oferta comercial do Cortex e roteiro de implantação

6 de novembro de 2026. Os preços são **proposta para decisão dos sócios (D23)**. A base de mercado, com fontes, está em [pesquisa/PRECOS_MERCADO.md](pesquisa/PRECOS_MERCADO.md). O que o site pode afirmar está em [AFIRMACOES.md](AFIRMACOES.md).

## O que vendemos

**Produto mais implantação**, para clínicas de especialidade com 3 a 15 médicos e recepção própria. O Cortex não disputa preço de lista. A diferença é que a clínica recebe o sistema já funcionando: histórico migrado, modelos de cada médico, recepção configurada e equipe treinada.

| Plano por médico (contrato anual) | Proposta | Inclui |
|---|---|---|
| Essencial | R$ 179 (faixa R$ 159–199) | Prontuário, agenda, recepção com delegação, receitas C1/C5, pedidos TUSS/CID-10, modelos, MFA, assinatura ICP-Brasil quando liberada |
| Completo | R$ 319 (faixa R$ 289–359) | Essencial mais consulta com IA: 150 consultas por médico por mês, somadas na clínica |
| Completo Plus | R$ 459 (opcional) | Franquia de 350 consultas e suporte prioritário |

**Regras:**
- Recepção e administrativo com usuários ilimitados.
- Mínimo de 3 licenças médicas por clínica.
- Planos podem ser misturados na mesma clínica.
- IA excedente a R$ 1,50 por consulta.
- Mensal sem fidelidade custa 15% a mais.
- Enquanto não houver WhatsApp em produção e faturamento TISS, usar o piso das faixas.

**Implantação (taxa única):**

| Porte | Sem migração | Com migração do sistema anterior |
|---|---|---|
| 3–5 médicos | R$ 2.000–3.500 | R$ 6.000–10.000 |
| 6–10 médicos | R$ 3.500–5.500 | R$ 9.000–15.000 |
| 11–15 médicos | R$ 5.000–8.000 | R$ 13.000–22.000 |

- Origem com conversor pronto (PersonalMed): piso da faixa.
- Origem nova: mais 30–50%, ou orçamento.
- Abatimento de 50% em contrato de 24 meses.

**Antes de cobrar, medir o custo real de IA por consulta (`usage_daily`).** No cenário pessimista da pesquisa (US$ 0,40 por consulta), a margem do Completo cai para cerca de 5%.

## Roteiro de implantação de uma clínica nova

Os prazos são típicos e são definidos no diagnóstico. Cada etapa tem um responsável e um critério de aceite.

| # | Etapa | O que acontece | Aceite |
|---|---|---|---|
| 1 | Diagnóstico (≈1 semana) | Entrevista com sócios e recepção: médicos, agendas, sistema atual, modelos, número de WhatsApp. Contrato e termo de tratamento de dados (LGPD). | Escopo e cronograma assinados |
| 2 | Ambiente (1–2 dias) | Projeto próprio em São Paulo (D11/D21), deploy do app com a marca da clínica (K5), migrations e funções aplicadas pelo procedimento de [DEPLOYMENT.md](../../reviews/2026-11-06/production-migration/DEPLOYMENT.md), catálogos carregados, segredos e cron | Login de teste, catálogos com contagem, funções `ACTIVE` |
| 3 | Migração (2–3 semanas) | Exportação do sistema anterior, conversor, staging cifrado fora do repositório, ensaio completo, conferência por amostragem com a clínica | Relatório do ensaio aprovado pela clínica |
| 4 | Configuração (≈1 semana) | Contas de médicos e recepção, permissões, modelos de documento, dados de prescritor, WhatsApp (conta Meta da clínica, número, modelos aprovados, automações), Google Agenda | Checklist de Configurações completo |
| 5 | Treinamento | Médicos: consulta, documentos, assinatura. Recepção: fila, agenda, conversas. Administração: configurações. | Cada pessoa fez seu fluxo sozinha |
| 6 | Virada | Carga final, sistema anterior em leitura, primeiro dia acompanhado | Primeiro dia sem bloqueio |
| 7 | Acompanhamento (30 dias) | Ajustes, dúvidas, medição de uso e de custo de IA | Encerramento assinado |

**O que a clínica fornece:**
- exportação ou acesso ao sistema atual;
- lista de médicos e da recepção;
- CNPJ e conta Meta Business, para o WhatsApp;
- modelos que já usa;
- uma pessoa responsável pela implantação.

**Antes da primeira venda:**
1. Decidir D21–D25.
2. Revisão jurídica de termos, privacidade e contrato de tratamento de dados.
3. Contrato de IA que cubra dados de saúde (D13/A0).
4. Ambiente de demonstração só com dados sintéticos.
5. Script que aplique migrations em todas as clínicas de uma vez, para evitar a defasagem de 06/11.
