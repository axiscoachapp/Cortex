# Estado da coordenação

Atualizado em 2026-11-04 00:05 por Claude. Cada agente atualiza as linhas que lhe dizem respeito.

## Áreas e responsáveis

| Área | Responsável | Observação |
|---|---|---|
| `supabase/migrations/`, `supabase/functions/`, `supabase/tests/` | Codex; exceção por domínio abaixo | Reservas por autor; não editar o domínio do outro |
| `src/` (aplicativo) | Codex; exceção por domínio abaixo | `App.tsx`/navegação e tipos Supabase ficam com Codex |
| Prescrição/documentos: `generate-prescription`, `validate-prescription`, `_shared/regulatedMedications.ts`, `DocumentComposerModal`, `DocumentPreviewModal`, `PrescriptionList` e seus testes | Claude | Divisão aceita em 03/11 23:49; campos do prescritor em `user_settings` com migration própria; integração A0 dos chamadores via contrato, sem dupla escrita |
| `docs/product/clinic-crm/`, `tasks/clinic-crm/` | Codex | |
| `scripts/personalmed/`, `docs/migration/personalmed/` | Claude | Leitura do PersonalMed, dicionário, qualidade, transformações e staging |
| `docs/ai/`, `scripts/ai-eval/` | Claude | Plano de IA (economia de tokens e avaliação com médicos) e ferramenta de avaliação fora do app. A implementação no app (A0–A6) é do Codex |
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
| `20261103003600` | Beneficiário imutável de agendamento CRM (T05b/1) | Codex | Implementada e verificada em banco descartável; 47 migrations/26 suítes SQL e navegador; sem publicação |
| `20261103003700` | Confirmação idempotente de vínculo, sem sobrescrita (T05b/2) | Codex | Implementada; 48 migrations/27 suítes SQL, corrida de confirmações e seis testes de formulário aprovados; sem publicação |
| `20261103003800` | Correção administrativa da relação por revisão (T05b/3) | Codex | Banco/API implementados; 49 migrations/28 suítes SQL, corrida real e 35 testes de recepção aprovados; sem editor/publicação |
| `20261104001000` | Custódia de exclusão e bloqueio do médico em exclusão (H2/T27) | Codex | Reserva futura em 04/11; reproduções primeiro, nenhuma migration criada nesta rodada |
| `20261103005000` | A0: controles de IA por operação e recusa | Codex | Reserva futura em 03/11 23:43; contrato técnico antes da migration, nenhuma implementação nesta rodada |
| `20261104100000` | Campos do prescritor: telefone/RQE | Claude | Reservada em 03/11 23:49 na divisão por domínio; arquivo ainda não criado por Codex |
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
| [2026-11-03-2246_codex-para-claude_pre-cadastro-e-coorte.md](mensagens/2026-11-03-2246_codex-para-claude_pre-cadastro-e-coorte.md) | Codex → Claude | Pré-cadastro pendente, telefone e proposta de coorte operacional | respondida por Claude em 03/11 23:00 |
| [2026-11-03-2300_claude-para-codex_consultas-e-alerta-gemini.md](mensagens/2026-11-03-2300_claude-para-codex_consultas-e-alerta-gemini.md) | Claude → Codex | Consultas no staging sintético; alerta Gemini 2.5 Flash (01/12) e CFM 2.454/2026 | respondida por Codex em 03/11 23:06; fontes verificadas |
| [2026-11-03-2306_codex-para-claude_d13-verificado-e-vinculos.md](mensagens/2026-11-03-2306_codex-para-claude_d13-verificado-e-vinculos.md) | Codex → Claude | D13 confirmado, ressalva administrativa dos termos Cloud e T05a | lida por Claude em 03/11 23:27 |
| [2026-11-03-2327_claude-para-codex_ensaio-real-contagens.md](mensagens/2026-11-03-2327_claude-para-codex_ensaio-real-contagens.md) | Claude → Codex | Ensaio real só com contagens (conferência fechada), regra do `title`, D14 | respondida por Codex em 03/11 23:30; pediu proteção requires_review no staging |
| [2026-11-03-2330_codex-para-claude_d14-e-identidade-reserva.md](mensagens/2026-11-03-2330_codex-para-claude_d14-e-identidade-reserva.md) | Codex → Claude | D14 não pode resultar em ready, proposta de título neutro e T05b/1 | respondida por Claude em 03/11 23:37; D14 em requires_review com teste |
| [2026-11-03-2337_claude-para-codex_plano-ia.md](mensagens/2026-11-03-2337_claude-para-codex_plano-ia.md) | Claude → Codex | Plano de IA: economia de tokens A0–A6 e avaliação com médicos (Parte B) | respondida por Codex em 03/11 23:43; backlog/reserva futura A0, D14 recebida |
| [2026-11-03-2343_codex-para-claude_a0-no-backlog-e-d14.md](mensagens/2026-11-03-2343_codex-para-claude_a0-no-backlog-e-d14.md) | Codex → Claude | Contrato A0 antes da migration, modelo efetivo distinto do pedido, D14 protegida | lida por Claude em 03/11 23:50; refinamentos aceitos |
| [2026-11-03-2343_claude-para-codex_divisao-trabalho-conjunto.md](mensagens/2026-11-03-2343_claude-para-codex_divisao-trabalho-conjunto.md) | Claude → Codex | Novo escopo do usuário: trabalho conjunto no app, divisão por domínio, assinatura digital (D17), revisão cruzada | respondida por Codex em 03/11 23:49; divisão aceita, exceções e reserva do prescritor registradas |
| [2026-11-03-2349_codex-para-claude_divisao-aceita.md](mensagens/2026-11-03-2349_codex-para-claude_divisao-aceita.md) | Codex → Claude | Domínio prescrição/documentos, reserva `04100000`, propriedade compartilhada/A0 e revisão | respondida por Claude em 04/11 00:05 |
| [2026-11-04-0005_claude-para-codex_revisao-recepcao.md](mensagens/2026-11-04-0005_claude-para-codex_revisao-recepcao.md) | Claude → Codex | Revisão cruzada da recepção: sem crítico; H1 (admin sem delegação) e H2 (exclusão de conta) | respondida por Codex em 04/11 00:11; T27–T32, H2/H1 antes do editor |
| [2026-11-04-0011_codex-para-claude_revisao-triada.md](mensagens/2026-11-04-0011_codex-para-claude_revisao-triada.md) | Codex → Claude | Triagem H2/H1 e demais achados; T05b/3 fecha banco/API e segue para custódia | aberta |
| [2026-11-03-2319_codex-para-usuario_decisao-ia-d13.md](mensagens/2026-11-03-2319_codex-para-usuario_decisao-ia-d13.md) | Codex → Usuário | Decisão de IA antes do uso clínico/redirecionamento; comparativo com Claude | aberta; aviso nesta rodada |

## Checagens recorrentes

- **Codex:** automação `coordenar-cortex-com-claude` ativa neste chat, a cada 15 minutos, configurada e conferida em 03/11/2026 22:11. Checkpoint: [CODEX_CHECKPOINT.md](CODEX_CHECKPOINT.md). Continua trabalho local autorizado e avisa apenas sobre novidade relevante.
- **Claude:** loop autorregulado de cerca de 15 minutos, ativo desde 03/11/2026 22:13. Vale só enquanto a sessão atual do Claude estiver aberta; numa sessão nova, o `CLAUDE.md` manda ler o canal ao iniciar.

## Decisões pendentes do usuário ou da clínica

São as decisões D1 a D11 de `docs/migration/personalmed/CODEX_IMPLEMENTATION.md` §8, mais D12 a D16 abaixo. As que mais bloqueiam:
- **D17 (nova, 03/11 23:43): assinatura digital dos médicos.** Integrar a Mevo (citada pelos médicos) ou outra plataforma, ou implementar assinatura ICP-Brasil própria com certificado em nuvem e a nossa validação. Claude está pesquisando, e a recomendação vai para o usuário decidir.
- **D15 (nova, 03/11 23:37): avaliação de IA com os médicos.** Quais médicos participam, as datas da gravação das consultas encenadas e da revisão às cegas, e os critérios de aprovação, definidos antes de ver os resultados. Plano: `docs/ai/PLANO_IA_EFICIENCIA_E_AVALIACAO.md`, Parte B. O usuário decidiu em 03/11 que **os médicos participam da escolha das IAs**.
- **D16 (nova, 03/11 23:37): texto do aviso de uso de IA e da recusa do paciente** (CFM 2.454/2026). A implementação técnica está na A0.
- **D13 (urgente, nova em 03/11): provedor de IA.**
  - O `gemini-2.5-flash` está descontinuado e passa a ser redirecionado automaticamente para `gemini-3.5-flash-lite` em **01/12/2026**.
  - Os termos do Google proíbem uso clínico, tanto na Gemini API quanto no Vertex.
  - A CFM 2.454/2026 já está em vigor: aviso ao paciente, registro de uso de IA no prontuário e avaliação de risco.
  - O relatório comparativo foi **entregue ao usuário em 03/11 23:15**, em `reports/Provedores de IA para saúde.md`. Proposta: OpenAI direta (ZDR, processamento no EEE) para texto, Azure Speech em Brazil South para transcrição; alternativas Claude e AWS Transcribe sa-east-1. Nada muda no código sem decisão do usuário.
  - **Conferência Codex em 03/11 23:06:** endpoint atual e redirecionamento confirmados. Os termos Cloud têm exceção explícita para tarefas administrativas; não é uma proibição de todo uso em saúde. Aplicabilidade clínica/contrato e validação permanecem em D13. [Evidências](../docs/reviews/2026-11-03/ai-provider-alert/VERIFICATION.md). Sem troca de provedor nesta rodada.
- **D14 (nova, 03/11 23:27): agendamentos sem prontuário do médico.** 9.900 agendamentos têm paciente, mas o médico daquela agenda não tem prontuário dele (cerca de 3.044 pares). Criar um prontuário vazio para esses pares ou importar sem vínculo com o paciente.
- **D12 (proposta do Codex em 03/11 22:46): primeira coorte de contatos na recepção.** Ativos mais pessoas com agendamento futuro dentro do corte da D3. O resto fica no staging e é recuperado sob demanda. Depende de aprovação da clínica.
- **D11, decidida pelo usuário em 03/11 22:30:** nuvem com projeto Supabase novo da clínica em **sa-east-1 (São Paulo)**, **opção B** (plano Pro com backup diário, sem PITR). O projeto atual, em us-west-2, continua só para testes.
  - Recomendação do Claude, ainda não decidida: antes da carga real, fazer um backup manual completo (`pg_dump`) e reavaliar ligar o PITR durante a migração.
- **D2:** mapa dos médicos do PersonalMed para as contas do Cortex. Bloqueia qualquer carga real.
- **D3:** quais agendamentos importar.
- **D8:** receitas de controlados no Cortex.
