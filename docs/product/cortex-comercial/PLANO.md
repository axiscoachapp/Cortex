# Cortex como produto: plano e divisão Claude ↔ Codex

6 de novembro de 2026. O pedido do usuário tem três partes:

- WhatsApp integrado à recepção, com número conectado, filas de atendimento e acompanhamento;
- uma página única de Configurações;
- identidade visual e produto completo, com site de marketing, para vender produto e implantação a clínicas.

A Haddad Nicola é a clínica piloto. Este plano complementa o [plano SaaS para médicos individuais](../cortex-saas/PRODUCT_SPEC.md), escrito em 29/10 por outra sessão, sem substituí-lo: aqui o cliente é a **clínica**, e o Cortex vem com implantação.

## Onde estamos (06/11)

| Pedido | Situação | Falta |
|---|---|---|
| WhatsApp | Só gera um link `wa.me` para o lembrete. Não recebe mensagens e não tem caixa de entrada. A fila da recepção (`reception_cases`, `clinic_contacts`) já existe e é manual. | Conexão oficial com a Meta, webhook, mensagens guardadas, caixa de conversas na fila, respostas, modelos e acompanhamento |
| Configurações | Espalhadas: gaveta do prescritor (engrenagem), `/seguranca`, `/compartilhamento` (que também cria contas de médico), `/permissoes-recepcao`, `/recepcao/equipe` e `/privacidade`. A conexão com o Google fica dentro da Agenda, e a da assinatura dentro dos documentos. | Uma página `/configuracoes` que reúna tudo e mostre o estado das conexões |
| Marca e marketing | O app usa a marca da Haddad Nicola, com "Cortex · Ambiente clínico" em letra pequena. Não há site, oferta nem preço. | Identidade Cortex, site público, oferta comercial, roteiro de implantação e textos legais |

## Divisão

### Claude

| Item | Entrega | Onde |
|---|---|---|
| C1 | Identidade visual: posicionamento, voz, logotipo, cores, tipografia, regras de co-marca com a clínica, tokens | `docs/brand/`, `brand/` |
| C2 | Site de marketing pré-renderizado: início, funcionalidades, implantação, segurança, preços, contato/demonstração, termos e privacidade | `site/` (pacote próprio, deploy separado do app) |
| C3 | Oferta comercial: proposta de preços, pacote de implantação, roteiro de implantação de clínica nova, registro do que o site pode afirmar | `docs/product/cortex-comercial/` |
| C4 | **WhatsApp, camada de transporte:** migration, cliente da Cloud API, webhook com assinatura, gravação idempotente, conexão do número, envio dentro e fora da janela de 24 h, leitura da caixa pela recepção e contrato da API | migration `20261106100000`, `supabase/functions/whatsapp-*`, `_shared/whatsapp*.ts`, `docs/product/whatsapp/` |
| C5 | **Página `/configuracoes`:** perfil profissional (já é domínio Claude: `SpecialtySettingsSheet`/`useUserSettings`), conexões (WhatsApp, Google Agenda, assinatura digital, IA, e-mail) e atalhos para as páginas do Codex | `src/pages/Settings.tsx`, `src/features/settings/` e, sob lease, rota em `App.tsx` e entradas de menu |

### Codex

| Item | Entrega | Depende de |
|---|---|---|
| K1 | **Caixa de conversas na recepção:** aba "Conversas" em `/recepcao`, com filtros (não atribuídas, minhas, todas). A conversa abre ligada ao `reception_case`, permite assumir e transferir, e responde dentro da janela ou por modelo fora dela. Também vincula o contato, abre a agenda ao lado e mostra o contador de não lidas. | Contrato C4 (dá para começar com a função simulada) |
| K2 | **Acompanhamento da recepção:** tempo até a primeira resposta, conversas abertas por pessoa, abandonos e agendamentos gerados, com definições explícitas | K1 |
| K3 | Lembretes e confirmações por modelo de WhatsApp quando o canal estiver conectado. A resposta "confirmo" do paciente vira um status do agendamento revisável pela recepção. | C4, K1 |
| K4 | Seções embutidas em `/configuracoes` para Segurança, Permissões, Equipe, Compartilhamento e Privacidade, com página "Usuários" unificada (médicos e recepção: ativar, desativar, nova senha temporária) e perfil da clínica (nome, CNPJ, endereço, logotipo), com migration própria | C5 (layout) |
| K5 | Marca por implantação no app: nome, logotipo e cor da clínica configuráveis, com o padrão Cortex. A Haddad Nicola continua com a marca dela. | C1 (tokens) |
| K6 | Revisão da migration e das funções C4 (RLS, grants, autorização) e da parte do lease em C5 | C4, C5 |
| Segue | M2 (provisionamento de clínica nova) e A0 (provedor de IA da D13), já em andamento | — |

**Por que essa divisão:** a fila, os contatos e as permissões da recepção são do Codex, com contratos e provas próprios. A caixa de conversas vive dentro deles. O transporte do WhatsApp (Meta, webhook, cifra do token, janela) é uma camada separada, com contrato claro, e pode andar em paralelo. As páginas de segurança e de permissões estão em auditoria pelo Codex (T39), então ficam com ele; a página de Configurações começa como um painel com o que é meu e atalhos para o resto.

## Desenho do WhatsApp (C4)

- **Caminho:** WhatsApp Business Platform (Cloud API), um número por clínica. Não usar automação de WhatsApp Web. A pesquisa de BSP e de custos fica em [pesquisa/WHATSAPP_OPCOES.md](pesquisa/WHATSAPP_OPCOES.md).
- **Conexão (administrador da clínica, em Configurações → Conexões):** informa o ID do número, o ID da conta WhatsApp Business e o token de usuário do sistema. O servidor:
  1. confere esses dados na Graph API;
  2. inscreve o app nos webhooks da conta;
  3. guarda o token cifrado (AES-GCM, com a chave `WHATSAPP_TOKEN_KEY` no servidor);
  4. mostra o número, o nome verificado e a qualidade.

  O cadastro incorporado (Embedded Signup) da Meta fica para quando o Cortex for Tech Provider.
- **Recebimento:** `whatsapp-webhook` público.
  1. Responde ao desafio com `WHATSAPP_VERIFY_TOKEN`.
  2. Confere `X-Hub-Signature-256` com `WHATSAPP_APP_SECRET`.
  3. Grava o evento bruto com chave única antes do ACK.
  4. Processa sem duplicar: conversa por telefone, mensagem por `wamid`, status de entrega e leitura.
  5. Liga ao contato da clínica pelo telefone normalizado e abre um `reception_case` "novo" quando não há atendimento aberto.
- **Envio:** `whatsapp-send`, para recepção e administrador. Envia texto livre só dentro da janela de 24 h desde a última mensagem do paciente; fora dela, apenas modelo aprovado. É idempotente por `request_id`. Respeita o opt-out ("SAIR"/"PARAR").
- **Leitura:** `whatsapp-inbox` lista conversas e mensagens da clínica do usuário, autorizado por `clinic_access()`. Na v1 as tabelas não têm política para `authenticated`: tudo passa pelas funções com conferência explícita. RLS com Realtime fica para revisão do Codex (K6).
- **Mídia:** imagens, áudios e documentos são baixados para um bucket privado e servidos por URL assinada curta.
- **Segredos:** nada de token em código, repositório ou mensagem.

## Decisões do usuário

| # | Decisão | Recomendação |
|---|---|---|
| D21 | Modelo de implantação | **Ambiente dedicado por clínica** (projeto Supabase e deploy próprios): isolamento forte, marca e região por clínica, contrato simples. Precisa de ferramenta para aplicar migrations em todas as clínicas; esse risco já apareceu em 06/11. |
| D22 | Domínio do site, e-mail e WhatsApp comerciais, razão social e CNPJ de quem vende | Necessário antes de publicar o site |
| D23 | Preços (mensalidade por médico, IA, implantação) | Proposta em [pesquisa/PRECOS_MERCADO.md](pesquisa/PRECOS_MERCADO.md). Até a decisão, o site mostra "sob proposta". |
| D24 | WhatsApp da Haddad Nicola: qual número, conta Meta Business da clínica (verificação por CNPJ), Cloud API direta ou parceiro | A pesquisa recomenda o caminho. Sem o número e a conta Meta, tudo roda só no simulador. |
| D25 | Nome "Cortex" | Fazer busca no INPI (classes 9, 42 e 44) antes de investir em domínio e material |

## O que não fazer

- Não citar a Haddad Nicola, médicos ou depoimentos no site sem autorização por escrito.
- Não afirmar no site o que ainda não está pronto: assinatura ICP-Brasil em produção, WhatsApp, dados no Brasil (a produção atual está em us-west-2) ou "a IA não treina com seus dados" sem contrato. O [registro de afirmações](AFIRMACOES.md) diz o que pode ir ao ar.
- Não publicar o site nem criar projeto na Vercel sem pedido explícito do usuário.
- Não usar dado real de paciente em demonstração: a demo usa ambiente próprio com dados sintéticos.
