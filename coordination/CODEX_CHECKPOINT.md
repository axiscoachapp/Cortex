# Checkpoint do Codex

Atualizado em 03/11/2026 22:11 (America/Sao_Paulo). Estado inicial da rotina recorrente autorizada pelo usuário. Manter este arquivo curto, com evidências e próximos passos; sem dados pessoais ou segredos.

## Rotina

- Automação: `coordenar-cortex-com-claude` — **Coordenar Cortex com Claude**.
- Estado confirmado no app: ativa; intervalo de 15 minutos; retoma este chat local em `E:\Work\Cortex\cortex`.
- Cada rodada consulta `AGENTS.md`, `coordination/README.md`, `ESTADO.md`, mensagens e backlog da clínica. Responde novidade uma vez e continua trabalho independente autorizado. Não repete confirmação de estado inalterado.
- A checagem do Claude foi solicitada no canal; ainda não foi confirmada. Não confundir o agendamento do Codex com uma automação já instalada no ambiente do Claude.

## Mensagens conhecidas

| Entrada | Conteúdo reconhecido | Tratamento |
|---|---|---|
| `2026-11-03-2143_claude-para-codex_resposta-ao-handoff.md` | SHA-256 `DDF19C1807B2F79D707556D0AA46DC7EEEC8E5BE7782FA51988A840847979E52` | Já respondida pela mensagem Codex de 21:48 e registrada no ESTADO; não responder de novo só pelo cabeçalho aberto |
| `2026-11-03-2148_codex-para-claude_recepcao-e-handoff.md` | Saída do Codex sobre schema/S2/S1/lote sintético | Aguardar resposta do Claude; não responder à própria mensagem |
| `2026-11-03-2211_codex-para-claude_checagem-recorrente.md` | Saída do Codex sobre a rotina | Aguardar confirmação de capacidade do Claude; sem polling ativo nesta rodada |

Atualizar os hashes/entradas quando houver mudança relevante de conteúdo. Conferir também `Responde a` e o ESTADO antes de decidir que uma mensagem exige ação. Não criar cadeia de mensagens que apenas confirme outra confirmação.

## Base de desenvolvimento

- Backend da recepção: `c19624e`; interface/evidências: `9af1b68`. O commit `418c1fa` contém o trabalho do Claude e deve ser preservado.
- Última verificação de código: 383 testes/63 arquivos, 24 suítes SQL e concorrência real, navegador sintético responsivo, lint sem erros, tipos/Edge/build aprovados. Detalhes em `docs/reviews/2026-11-03/reception-foundation/IMPLEMENTATION.md`.
- Código implementado localmente; migrations/Edge/frontend ainda não publicados. Não aplicar em banco hospedado como efeito da checagem.
- Próximo incremento independente elegível: planejar e implementar retificação administrativa auditada de contatos/vínculos, com revisão e escopo no servidor, sem ampliar acesso clínico. Conferir o backlog/estado e possíveis alterações concorrentes antes de começar. Não alterar contatos reais ou identidade canônica do legado nesta etapa.
- T08: regras por serviço dependem de configuração administrativa explícita; não inferir diagnóstico ou converter regras hipotéticas em política real da clínica.
- PersonalMed: extração/staging com Claude. Reserva S1 `20261103004000` existe, mas schema/carregador/carga não iniciados. Fonte canônica dos dados legais permanece em discussão S2.

## Pendências e avisos

- Nenhum bloqueio novo comunicado nesta configuração da rotina.
- D2/D3/D8 da migração continuam com os responsáveis registrados no ESTADO; não repetir essas pendências sem mudança ou dependência concreta do trabalho em execução.
- Alterações preexistentes de `tasks/plan.md`, `tasks/todo.md`, `Cortex/`, produto SaaS e documento de deployment de teste pertencem a outro trabalho. Não adicionar a commits da clínica.
