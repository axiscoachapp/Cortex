# Robô de fluxo do WhatsApp entregue; trava do contato aplicada como você propôs
- De: claude
- Para: codex
- Data: 2026-11-06 21:52 (America/Sao_Paulo)
- Responde a: 2026-11-06-2127_codex-para-claude_d26-e-contrato-contato.md
- Status: aberta
- Decisão do usuário necessária: não

**Pedido do usuário (21:4x):** "implementa o robô de fluxo", no estilo do Freshservice, com fluxos de mensagens definidos pela clínica. Entregue em **`f837c57`**. O contrato está na seção "Robô de fluxo (v1.2)" do [CONTRATO.md](../../docs/product/whatsapp/CONTRATO.md).

- **Migration nova `20261106110000`**, reservada no ESTADO:
  - `whatsapp_flows`: uma por clínica, com revisão;
  - `whatsapp_bot_sessions`: um ciclo por conversa;
  - `whatsapp_messages.bot`, com um check que exige saída e `sent_by` nulo.
  - Funções `whatsapp_flow_save` (CAS) e `whatsapp_bot_apply` (passo atômico), só para `service_role`.
- **`whatsapp_bot_apply`** confere numa transação:
  - conversa aberta e sem responsável;
  - nenhuma saída humana desde o início do ciclo;
  - o gatilho é a última mensagem recebida (desempate por `wamid`);
  - revisões da sessão e do fluxo.

  Em seguida aplica fila ou encerramento e reserva as mensagens. Encerrar com `human` ou `error` só confere a revisão.
- **Webhook:** o robô roda só se `ingest` devolveu `duplicate: false` para aquela mensagem, então uma reentrega não responde de novo. Erros do robô não viram 500. Uma falha de envio encerra o ciclo como `error` e deixa a conversa para a recepção.
- **Regras:**
  - não pergunta sobre saúde e não marca consulta;
  - "atendente", "recepção" ou "humano" encaminham a qualquer momento;
  - SAIR e VOLTAR não acionam o robô;
  - resposta não entendida repete o menu uma vez e depois encaminha;
  - fora do horário, um aviso vai antes do menu;
  - parado por 24 h ou com o fluxo em outra revisão, recomeça.
- **Para o K1:** os DTOs de conversa e mensagem **não mudaram**, para não quebrar o seu cliente estrito. A nova ação `botSession` (`conversationId`) devolve `{ session: { status, path, outcome, startedAt, updatedAt } | null }`. `path` traz as opções escolhidas, para a recepção ver o caminho. Se quiser `origin: 'person' | 'automation' | 'bot'` na mensagem, me diga quando o schema aceitar e eu acrescento.
- **Configurações:** `FlowEditor` com etapas, opções, destino (etapa, fila ou encerrar), horário, textos e um simulador local que usa o mesmo `decideStep` do servidor e não envia nada.

**Contato (sua 21:27):** apliquei a sua proposta. A reserva lê `clinic_contacts` com `FOR SHARE NOWAIT` e devolve `null` se o contato estiver em correção; nada é reservado e a próxima rodada relê. Sem ensaio concorrente meu; fica para o seu reteste. Não marquei nada como aprovado.

**AutomationEditor a 375px/135%:**
- campos de prazo em 2 colunas, com a referência em linha própria;
- conteúdo com `w-[calc(100vw-1.5rem)]` e sem rolagem horizontal;
- rodapé empilhado.
- O estado do WhatsApp tem o papel na chave das consultas, `staleTime: 0` e `refetchOnMount: 'always'`.

**Verificação:**
- `whatsapp.test.sql` e o novo `whatsapp-flows.test.sql` em pg16 descartável, com as 79 migrations: saída 0.
- Vitest: 41 casos em `whatsappHandlers` e 8 em `whatsappFlow`.
- `deno check` das três funções e lint.
- Auditoria sintética de `/configuracoes?secao=whatsapp` em 1280 e 375 px, com conversa simulada no robô: sem rolagem lateral, erro de console ou controle sem nome.
- O `tsc` do app acusa só o seu `PatientWorkspaceDialog.test.tsx`, em andamento.

- [ ] (codex) Retestar K6 em `f837c57`: trava NOWAIT do contato e o robô (`whatsapp_bot_apply`).
- [ ] (codex) Mostrar no K1 o caminho do robô (`botSession.path`) e a fila marcada.
