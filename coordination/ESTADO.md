# Estado da coordenação

Atualizado em 2026-11-03 21:43 por Claude. Cada agente atualiza as linhas que lhe dizem respeito.

## Áreas e responsáveis

| Área | Responsável | Observação |
|---|---|---|
| `supabase/migrations/`, `supabase/functions/`, `supabase/tests/` | Codex | Claude pede por mensagem o que precisar no banco |
| `src/` (aplicativo) | Codex | |
| `docs/product/clinic-crm/`, `tasks/clinic-crm/` | Codex | |
| `scripts/personalmed/`, `docs/migration/personalmed/` | Claude | Leitura do PersonalMed, dicionário, qualidade, transformações e staging |
| Staging da migração (fora do repositório, cifrado) | Claude | Formato definido em `docs/migration/personalmed/CODEX_IMPLEMENTATION.md` §3 |
| Carregador da migração (lado Cortex) | Codex | Consome o staging; ver S1 e S7 |
| Execução da carga real | Um executor designado pelo usuário | Ainda não definido |
| `coordination/` | Os dois | Siga o [README](README.md) |

## Migrações

| Número | Assunto | Dono | Situação |
|---|---|---|---|
| `20261103001000` | `reception_access` | Codex | Commit `c19624e` |
| `20261103002000` | `reception_workflow` | Codex | Commit `c19624e` |
| `20261103003000` | `reception_calendar` | Codex | Commit `c19624e` |
| `20261103004000` | S1: tabelas de origem da importação (`legacy_import_*`) | Codex | Reservada em 03/11 21:48; não iniciada, incremento futuro |
| a reservar | S2: campos legais do cadastro (contato, endereço, mãe, naturalidade, convênio) | Codex | Depende de T04/T05 |

## Conversas

| Arquivo | De → Para | Assunto | Status |
|---|---|---|---|
| [2026-11-03-2143_claude-para-codex_resposta-ao-handoff.md](mensagens/2026-11-03-2143_claude-para-codex_resposta-ao-handoff.md) | Claude → Codex | Resposta ao `DATABASE_HANDOFF.md` e especificação S1–S8 | respondida por Codex em 03/11 21:48 |
| [2026-11-03-2148_codex-para-claude_recepcao-e-handoff.md](mensagens/2026-11-03-2148_codex-para-claude_recepcao-e-handoff.md) | Codex → Claude | Schema atual, S2, reserva S1 e lote sintético | aberta |
| [2026-11-03-2211_codex-para-claude_checagem-recorrente.md](mensagens/2026-11-03-2211_codex-para-claude_checagem-recorrente.md) | Codex → Claude | Rotina de 15 minutos e continuidade por área | aberta |

## Checagens recorrentes

- **Codex:** automação `coordenar-cortex-com-claude` ativa neste chat, a cada 15 minutos, configurada e conferida em 03/11/2026 22:11. Checkpoint: [CODEX_CHECKPOINT.md](CODEX_CHECKPOINT.md). Continua trabalho local autorizado e avisa apenas sobre novidade relevante.
- **Claude:** solicitada confirmação da própria rotina no canal; agendamento ainda não confirmado pelo Codex.

## Decisões pendentes do usuário ou da clínica

São as decisões D1 a D10 de `docs/migration/personalmed/CODEX_IMPLEMENTATION.md` §8. As que mais bloqueiam:
- **D2:** mapa dos médicos do PersonalMed para as contas do Cortex. Bloqueia qualquer carga real.
- **D3:** quais agendamentos importar.
- **D8:** receitas de controlados no Cortex.
