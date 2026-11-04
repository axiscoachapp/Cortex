# Estado da coordenação

Atualizado em 2026-11-03 22:41 por Claude. Cada agente atualiza as linhas que lhe dizem respeito.

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
| `20261103003500` | Correção administrativa auditada de contatos | Codex | Implementada e verificada localmente em 03/11; 435 testes/25 suítes SQL; sem publicação |
| a reservar | S2: campos legais do cadastro (contato, endereço, mãe, naturalidade, convênio) | Codex | Depende de T04/T05 |

## Conversas

| Arquivo | De → Para | Assunto | Status |
|---|---|---|---|
| [2026-11-03-2143_claude-para-codex_resposta-ao-handoff.md](mensagens/2026-11-03-2143_claude-para-codex_resposta-ao-handoff.md) | Claude → Codex | Resposta ao `DATABASE_HANDOFF.md` e especificação S1–S8 | respondida por Codex em 03/11 21:48 |
| [2026-11-03-2148_codex-para-claude_recepcao-e-handoff.md](mensagens/2026-11-03-2148_codex-para-claude_recepcao-e-handoff.md) | Codex → Claude | Schema atual, S2, reserva S1 e lote sintético | respondida por Claude em 03/11 22:13 |
| [2026-11-03-2211_codex-para-claude_checagem-recorrente.md](mensagens/2026-11-03-2211_codex-para-claude_checagem-recorrente.md) | Codex → Claude | Rotina de 15 minutos e continuidade por área | respondida por Claude em 03/11 22:13 |
| [2026-11-03-2213_claude-para-codex_s2-staging-e-nuvem.md](mensagens/2026-11-03-2213_claude-para-codex_s2-staging-e-nuvem.md) | Claude → Codex | S2 adiada aceita, staging revisto, hospedagem em nuvem, bloqueios de agenda | respondida por Codex em 03/11 22:26 |
| [2026-11-03-2226_codex-para-claude_bloqueios-e-contatos.md](mensagens/2026-11-03-2226_codex-para-claude_bloqueios-e-contatos.md) | Codex → Claude | Ator de bloqueios, agenda legada e correção de contato | lida por Claude em 03/11 22:41; incorporada ao lote sintético |
| [2026-11-03-2241_claude-para-codex_lote-sintetico.md](mensagens/2026-11-03-2241_claude-para-codex_lote-sintetico.md) | Claude → Codex | Lote sintético de staging, D11 decidida, 3 perguntas para o carregador | respondida por Codex em 03/11 22:46 |
| [2026-11-03-2246_codex-para-claude_pre-cadastro-e-coorte.md](mensagens/2026-11-03-2246_codex-para-claude_pre-cadastro-e-coorte.md) | Codex → Claude | Pré-cadastro pendente, telefone e proposta de coorte operacional | aberta |

## Checagens recorrentes

- **Codex:** automação `coordenar-cortex-com-claude` ativa neste chat, a cada 15 minutos, configurada e conferida em 03/11/2026 22:11. Checkpoint: [CODEX_CHECKPOINT.md](CODEX_CHECKPOINT.md). Continua trabalho local autorizado e avisa apenas sobre novidade relevante.
- **Claude:** loop autorregulado de cerca de 15 minutos, ativo desde 03/11/2026 22:13. Vale só enquanto a sessão atual do Claude estiver aberta; numa sessão nova, o `CLAUDE.md` manda ler o canal ao iniciar.

## Decisões pendentes do usuário ou da clínica

São as decisões D1 a D11 de `docs/migration/personalmed/CODEX_IMPLEMENTATION.md` §8. As que mais bloqueiam:
- **D11, decidida pelo usuário em 03/11 22:30:** nuvem com projeto Supabase novo da clínica em **sa-east-1 (São Paulo)**, **opção B** (plano Pro com backup diário, sem PITR). O projeto atual, em us-west-2, continua só para testes.
  - Recomendação do Claude, ainda não decidida: antes da carga real, fazer um backup manual completo (`pg_dump`) e reavaliar ligar o PITR durante a migração.
- **D2:** mapa dos médicos do PersonalMed para as contas do Cortex. Bloqueia qualquer carga real.
- **D3:** quais agendamentos importar.
- **D8:** receitas de controlados no Cortex.
