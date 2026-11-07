# WhatsApp da recepção: contrato

Versão 1.1, 06/11/2026 (correções da revisão K6 do Codex, mensagens 20:09 e 20:31). A camada de transporte é do Claude (C4). A caixa de conversas, o acompanhamento e a confirmação na agenda são do Codex (K1–K3), e a revisão de RLS e autorização também (K6). O plano está em [PLANO.md](../cortex-comercial/PLANO.md), e a pesquisa de caminhos e custos em [WHATSAPP_OPCOES.md](../cortex-comercial/pesquisa/WHATSAPP_OPCOES.md).

## O que existe

| Peça | Arquivo | Papel |
|---|---|---|
| Migration | `supabase/migrations/20261106100000_whatsapp_channel.sql` | Canal, conversas, mensagens, eventos do webhook, modelos, automações e execuções |
| Webhook | `supabase/functions/whatsapp-webhook` | Público. Desafio GET; POST com `X-Hub-Signature-256` |
| API | `supabase/functions/whatsapp-api` | JWT. Conexão, modelos, caixa de conversas e automações |
| Automações | `supabase/functions/whatsapp-automations` | Chamada pelo pg_cron com `x-cortex-cron` |
| Lógica | `supabase/functions/_shared/whatsapp.ts`, `whatsappHandlers.ts`, `whatsappDeps.ts` | Leitura do payload, cliente Graph, handlers com dependências injetadas |
| Testes | `src/lib/whatsappHandlers.test.ts` (Vitest), `supabase/tests/whatsapp.test.sql` | Sintéticos |

**Acesso.**
- As sete tabelas têm RLS sem política para `anon`/`authenticated`. Só as funções, com service role, chegam a elas.
- A API identifica quem chama por `requireUser`, que exige aal2 quando a conta tem fator verificado, e por `clinic_access()`. A clínica e o papel nunca vêm do corpo da requisição.
- A caixa é da **recepção ativa** e do **administrador** da clínica. Médico não administrador vê só o estado da conexão.
- Todas as conversas da clínica aparecem para toda a recepção. Não há recorte por médico, porque o número é da clínica.

**Nada aqui escreve em `reception_cases` ou `clinic_contacts`.**
- A conversa só aponta para eles (`contact_id`, `case_id`).
- O contato é ligado automaticamente só quando exatamente um contato da clínica tem aquele telefone, considerando as formas com e sem o nono dígito.
- O atendimento (`case_id`) é ligado pela recepção, pela ação `link_case`.

## Configuração por ambiente (segredos das Edge Functions)

| Segredo | Para quê |
|---|---|
| `WHATSAPP_APP_SECRET` | Chave secreta do app da Meta, para conferir a assinatura do webhook |
| `WHATSAPP_VERIFY_TOKEN` | Texto aleatório informado na Meta para verificar a URL |
| `WHATSAPP_TOKEN_KEYS` | `k1:<base64 de 32 bytes>`, no mesmo formato de `SIGNATURE_TOKEN_KEYS`. Cifra o token de cada número. |
| `WHATSAPP_CRON_SECRET` | 32 ou mais caracteres; o pg_cron envia no cabeçalho `x-cortex-cron` |
| `WHATSAPP_GRAPH_VERSION` | Opcional; padrão `v24.0` |

O webhook fica em `https://<ref>.supabase.co/functions/v1/whatsapp-webhook` e assina o campo `messages`. Sem os segredos, o webhook responde 503 e a conexão é recusada com `server_not_ready`.

**Agendamento das automações** (uma vez por ambiente, depois de criar o segredo no Vault; precisa de `pg_cron` e `pg_net`):

```sql
select cron.schedule('whatsapp-automations', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/whatsapp-automations',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cortex-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_cron_secret')),
    body := '{}'::jsonb)
$$);
```

## Conectar o número (administrador, em Configurações)

**Antes, fora do Cortex**, seguindo a pesquisa (caminho A):
1. A clínica cria ou usa o portfólio Meta Business e verifica a empresa pelo CNPJ.
2. Cria o app.
3. Adiciona um número dedicado.
4. Gera o token de **usuário do sistema** com `whatsapp_business_messaging` e `whatsapp_business_management`.

Registre o número com `data_localization_region=BR` antes de usá-lo; isso não pode ser ligado depois.

**No Cortex:** `connect` recebe `{ phoneNumberId, wabaId, accessToken, pin? }`. O servidor:
1. confere o número na Graph API;
2. confere que ele pertence à conta;
3. registra o número, se o PIN veio;
4. inscreve o app nos webhooks;
5. guarda o token cifrado (AES-GCM, com AAD ligando canal e clínica);
6. sincroniza os modelos.

O token não volta em nenhuma resposta.

## API `whatsapp-api`

Sempre `POST`, com JSON `{ "action": ..., ... }`. Os erros vêm como `{ error, code }`:

| `code` | Significado |
|---|---|
| `forbidden` | 403 |
| `invalid` | 400 |
| `not_found` | 404 |
| `not_connected` | 409 |
| `window_closed` | 409, janela de 24 h fechada |
| `opted_out` | 409, a pessoa pediu para sair |
| `stale` | 409, revisão antiga |
| `template` | 400 |
| `server_not_ready` | 503 |
| `token_unreadable` | 503 |
| `send_failed` | 502 |
| `graph_<código>` | 502, com a mensagem da Meta traduzida |

| Ação | Quem | Entrada | Saída |
|---|---|---|---|
| `state` | Qualquer membro | — | `{ serverReady, connected, status, displayPhone, verifiedName, quality, connectedAt, canManage, canUseInbox }`. O admin recebe também `lastError`, `webhookUrl`, `phoneNumberId` e `wabaId`. |
| `connect` | Admin | `phoneNumberId`, `wabaId`, `accessToken`, `pin?` | `{ connected, displayPhone, verifiedName, quality, templates }` |
| `disconnect` | Admin | — | `{ connected: false }`; o token é apagado |
| `syncTemplates` | Admin | — | `{ templates: n }` |
| `templates` | Recepção e admin | — | `{ templates: [{ name, language, category, status, body, paramCount }] }` |
| `conversations` | Recepção e admin | `filter: 'unassigned' \| 'mine' \| 'open' \| 'closed'`, `search?` (nome, ou 4+ dígitos do telefone), `before?` (cursor opaco `data\|id` vindo de `nextBefore`), `limit?` (até 100) | `{ conversations: [Conversa], nextBefore }` |
| `messages` | Recepção e admin | `conversationId`, `before?` | `{ conversation, messages: [Mensagem] (mais recentes primeiro), nextBefore }` |
| `send` | Recepção e admin | `conversationId`, `requestId` (UUID do cliente), e `text` **ou** `template: { name, language, params: string[] }` | `{ messageId, status, duplicate }`. `status` é `sent`, ou `unrecorded` (a Meta aceitou, mas o registro falhou e o ID foi para o log). Com **202**, `status: 'unknown'` e `warning`: a Meta não respondeu e não há reenvio automático. |
| `act` | Recepção e admin | `conversationId`, `operation`, `revision` (dispensável em `mark_read`), `targetUserId?` (padrão: quem chama), `targetId?`, `queue?` | `{ revision, status, assignedTo }` |
| `media` | Recepção e admin | `messageId` | O arquivo, com `Content-Disposition: attachment` |
| `automations` | Admin | — | `{ automations, runs (últimas 100), sources, quietHours }` |
| `saveAutomation` | Admin | `id?`, `revision?`, `rule: { name, enabled, trigger, offsetMinutes, templateName, templateLanguage, params, linkUrl?, doctorIds?, appointmentTypes? }` | `{ id, revision }` |
| `deleteAutomation` | Admin | `id` | `{ deleted: true }` |

**Operações de `act`:** `assign`, `unassign`, `close`, `reopen`, `mark_read`, `link_contact`, `link_case`, `set_queue`, `record_opt_in` (a recepção registra que a pessoa autorizou mensagens pelo WhatsApp) e `revoke_opt_in`.
- `assign` aceita recepção ativa ou administrador da clínica.
- `mark_read` também manda o recibo de leitura ao celular do paciente, em melhor esforço.

**Conversa:**
- Identificação: `id`, `waId` (pode ser `null`: a Meta às vezes só informa o ID por usuário, o BSUID), `profileName`, `contactId`, `caseId`.
- Fila e responsável: `queue`, `status` (`open` ou `closed`), `assignedTo`, `assignedAt`.
- Tempos: `openedAt`, `firstResponseAt`, `closedAt`, `lastInboundAt`, `windowOpenUntil`, `lastMessageAt`.
- Outros: `lastMessagePreview`, `unreadCount`, `optedOut`, `consented` (há consentimento vigente para o telefone), `revision`.

**Mensagem:**
- Campos: `id`, `direction` (`in` ou `out`), `kind`, `body`, `media` (`{ mime, filename, voice }` ou `null`), `template`, `status`, `error`, `sentBy`, `at`.
- `status` vai de `received` (entrada) e `pending` → `sent` → `delivered` → `read`, ou termina em `failed` (a Meta recusou) ou `unknown` (sem resposta; conferir antes de reenviar).

## Regras de negócio

- **Janela de 24 h:** texto livre só até 24 h depois da última mensagem do paciente (`windowOpenUntil`). Fora dela, só modelo aprovado. A conferência é atômica no banco (`P0W01`).
- **Sair:** "SAIR", "PARAR", "STOP", "CANCELAR LEMBRETES" ou "NÃO QUERO RECEBER" (texto ou botão) marca `opted_out_at`, e nenhum modelo sai depois disso (`P0W02`). "VOLTAR" ou "RECEBER LEMBRETES" desfaz. Uma resposta humana dentro da janela continua permitida, porque foi a pessoa que escreveu.
- **Consentimento:** automações só saem para quem tem consentimento vigente em `whatsapp_opt_ins`. Ele é registrado pela recepção (`record_opt_in`) ou pela própria pessoa ("VOLTAR"). "SAIR" revoga. O cadastro pode registrar com origem `cadastro` quando a S2 tiver o campo.
- **Destinatário:** é lido e fixado na reserva, sob lock, e devolvido ao handler, que envia exatamente para ele (`to` ou `recipient`) e o grava em `whatsapp_messages.recipient`.
- **Resultado:** recusa da Meta (4xx) vira `failed`; sem resposta ou 5xx vira `unknown`, e nada é reenviado sozinho. Uma aceitação cujo registro falha é tentada três vezes e depois vai para o log com o `wamid`.
- **Idempotência:**
  - entrada pelo `wamid`;
  - envio por `(clínica, autor, requestId)`; repetir o mesmo `requestId` com o mesmo conteúdo devolve `duplicate: true` e não envia de novo, e com outro conteúdo é recusado;
  - eventos pelo SHA-256 do corpo, que é apagado depois de processado;
  - uma falha no processamento responde 500, e a Meta reenvia.
- **Fila:**
  - Mensagem nova numa conversa fechada reabre a conversa, mantém o responsável e zera `firstResponseAt`.
  - A primeira resposta humana grava `firstResponseAt`.
  - A automação não conta como resposta e não limpa o contador de não lidas.
- **BSUID:** a conversa é encontrada pelo BSUID ou pelo telefone. Se já existirem uma conversa só com telefone e outra só com BSUID, a entrega com os dois fica na encontrada, sem copiar a chave que pertence à outra: nada é fundido em silêncio e o webhook não entra em laço de erro. O envio usa `to` quando há telefone e `recipient` (BSUID) quando não há. Uma troca de número ou de BSUID (`system`) move a conversa, solta o contato vinculado e registra uma nota sem o número.
- **Política do WhatsApp (23/09/2026):** a política proíbe enviar ou pedir informação de saúde e pedir documentos pelo canal. Os modelos devem ser neutros ("sua consulta é dia {{2}}"); o conteúdo clínico fica em link para página própria.

## Automações da agenda

O administrador cria regras em Configurações. Cada regra combina:
- quando: `before_start` (N minutos antes do início) ou `after_end` (N minutos depois do fim), com até 14 dias;
- qual modelo aprovado enviar;
- de onde vem cada campo do modelo: `paciente_primeiro_nome`, `data`, `hora`, `dia_semana`, `medico`, `clinica`, `link` (o `linkUrl` da regra, em HTTPS) ou `texto` (fixo, até 200 caracteres);
- filtros opcionais por médico e por tipo de consulta.

**Funcionamento:**
- O pg_cron chama a função a cada 10 minutos. Fora das 08:00–20:00 (São Paulo) nada sai, e a mensagem espera o horário. Lembretes atrasados mais de 14 h são descartados.
- **Consultas elegíveis:** só as da agenda da clínica (`appointments.clinic_id`), nunca a agenda particular do médico. Antes do início, só `agendado` ou `confirmado`, com início a mais de 1 h; depois do fim, só `realizado`.
- **Uma vez por regra, consulta e horário de início:** remarcar gera um lembrete novo.
- **Telefone:** só o do contato da recepção ligado à consulta. O prontuário do paciente não é lido.
- **Reconferência na reserva:** sob lock, a reserva confere de novo clínica, horário, situação, telefone, consentimento e "SAIR". Se algo mudou, a execução fica `skipped` com o motivo.
- **Pulos e falhas ficam registrados** com o motivo em `runs`: quem saiu, quem não tem telefone, modelo não aprovado, campos alterados, falha da Meta.
- **Conversa criada:** a automação cria a conversa **fechada**. Ela só entra na fila quando o paciente responde.
- **Botões do modelo:** a resposta por botão ("Confirmar", "Remarcar") fica gravada na execução (`reply`, `replied_at`), ligada pela mensagem respondida.

**Para o Codex (K3):** levar a resposta à agenda como status revisável pela recepção, pelos escritores existentes de agendamento, sem escrita direta.

## Limites da v1 e pendências

- **Opt-in pelo cadastro:** a tabela e as ações existem; falta o campo no cadastro e no agendamento (S2/K3, Codex), para a recepção registrar o consentimento ao marcar a consulta.
- **Mídia:** é baixada sob demanda, mas a Meta guarda por no máximo 30 dias. Para arquivar no Storage privado falta decidir a retenção.
- **Recepção:** a caixa consulta a API a cada poucos segundos. RLS com Realtime fica para a revisão K6.
- **Modelos:** a sincronização é manual (`syncTemplates`). Ouvir `message_template_status_update` fica para depois.
- **Vários números:** um número por clínica. O Embedded Signup (caminho B, Tech Provider) fica para quando houver mais clínicas.
- **Custo:** o registro de categoria e preço por mensagem (`pricing` nos status) não está implementado.
- **Retenção:** sem regra de retenção para conversas e mensagens. Decidir com a clínica (LGPD).
- **Produção:** nada foi publicado. A migration e as três funções precisam de aplicação explícita, junto com os segredos e o cron.

## Robô de fluxo (v1.2)

Migration `20261106110000_whatsapp_flows.sql`; lógica pura em `supabase/functions/_shared/whatsappFlow.ts`, que o simulador de Configurações também usa. O robô roda dentro do webhook, só depois de uma mensagem gravada agora: uma reentrega nunca responde duas vezes.

**O que faz:** responde quem escreve para a clínica com um menu (até 3 botões ou uma lista de até 10 opções) e cada opção leva a:
- outra etapa;
- uma fila da recepção (`queue:<fila>`): a conversa fica aberta, sem responsável e com a fila marcada;
- encerrar (`close`).

Uma etapa sem opções termina em encerrar ou em fila.

**Mensagens automáticas e limites:**
- Fora do horário configurado, a mensagem de fora do horário vai antes do menu.
- Resposta não entendida: repete o menu uma vez e depois encaminha para a fila padrão.
- "atendente", "recepção" ou "humano" encaminham a qualquer momento.
- "SAIR" e "VOLTAR" não acionam o robô.

**Quando para:**
- quando alguém é atribuído à conversa;
- quando uma pessoa responde durante o ciclo;
- quando o ciclo já encaminhou ou encerrou: só recomeça quando a conversa for reaberta;
- depois de 24 h parado, ou se o fluxo mudar de revisão, recomeça do início.

**Proibido por desenho:** perguntas de saúde (política do WhatsApp) e marcar consulta sozinho.

**Atomicidade:** `whatsapp_bot_apply` faz cada passo numa transação:
- confere que a conversa continua aberta e sem responsável, sem resposta humana no ciclo, com a mensagem gatilho sendo a última recebida, e confere as revisões da sessão e do fluxo;
- atualiza a sessão e aplica fila ou encerramento;
- reserva as mensagens (`bot = true`, `sent_by` nulo).

O handler envia cada mensagem e registra o resultado com `whatsapp_finish_outbound`. Falha no envio encerra o ciclo como `error`, e a conversa fica para a recepção.

**API (admin):**
- `flow` (`clinicName?`, `doctors?`) devolve o fluxo salvo ou um inicial (`starter: true`, `revision: 0`).
- `saveFlow` (`revision`, `flow`) valida e salva com controle de revisão (`stale` se mudou).

**API (recepção e admin):** `botSession` (`conversationId`) devolve `{ session: { status, path, outcome, startedAt, updatedAt } | null }`. `path` traz as opções escolhidas pelo paciente, por exemplo `["Marcar ou remarcar", "Dra. Ana"]`. Os DTOs de conversa e mensagem **não mudaram**, para não quebrar o cliente estrito do K1. Expor a origem da mensagem (pessoa, automação ou robô) fica para quando o cliente aceitar.
