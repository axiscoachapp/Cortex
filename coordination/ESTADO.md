# Estado da coordenação

Atualizado em 2026-11-04 02:13 por Codex. Cada agente atualiza as linhas que lhe dizem respeito.

## Áreas e responsáveis

| Área | Responsável | Observação |
|---|---|---|
| `supabase/migrations/`, `supabase/functions/`, `supabase/tests/` | Codex; exceção por domínio abaixo | Reservas por autor; não editar o domínio do outro |
| `src/` (aplicativo) | Codex; exceção por domínio abaixo | `App.tsx`/navegação e tipos Supabase ficam com Codex |
| Prescrição/documentos: `generate-prescription`, `validate-prescription`, `_shared/regulatedMedications.ts`, `DocumentComposerModal`, `DocumentPreviewModal`, `PrescriptionList` e seus testes | Claude | Divisão aceita em 03/11 23:49; campos do prescritor em `user_settings` com migration própria; integração A0 dos chamadores via contrato, sem dupla escrita |
| `SpecialtySettingsSheet.tsx`, `useUserSettings.ts` | Claude, incremento do prescritor | Delegados pelo Codex em 04/11 00:35 para telefone/RQE e testes; demais áreas não mudam |
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
| `20261104001000` | Custódia de exclusão e bloqueio do médico em exclusão (H2/T27) | Codex | T27/1 concluída; H2 complementada e encerrada localmente por `02000`, sem publicação |
| `20261104002000` | T27/2b: barreira de custódia e intenção monotônica | Codex | Implementada; 53 migrations/32 suítes SQL, concorrência anterior, oito ordens de exclusão e 26 testes de handlers aprovados. H2 concluída; próxima H1/T28 |
| `20261104003000` | T28/1: separar administração de acesso às agendas | Codex | Implementada: diretório de equipe separado, admin sem agenda alheia implícita; 55 migrations/33 SQL, 43 testes da recepção, 19 verificações de navegador. M2/D18 e L5 ainda abertos |
| `20261103005000` | A0: controles de IA por operação e recusa | Codex | Reserva futura em 03/11 23:43; contrato técnico antes da migration, nenhuma implementação nesta rodada |
| `20261104100000` | Campos do prescritor: telefone/RQE | Claude | Commit `7427926` em 04/11 00:31; revisão técnica Codex sem novo bloqueador, tipos regenerados/typecheck e 19 testes de documentos aprovados; interface entregue por Claude em `a715210` (04/11 00:58); verificação visual pendente |
| `20261104110000` | S3 MVP: `document_snippets` (modelos de receita do próprio médico) | Claude | Commit `2e5b844`; tipos por Codex em `b51a806`; revisão Codex com R1; interface no compositor em `1024e3f` (04/11 01:55) |
| `20261104120000` | R1: `document_snippet_writer` toca o epoch de custódia | Claude | Commit `5467a7b`; revisão Codex aprovada, ensaio incluído no `test:db` e aprovado. S3 UI tem R2 de seleção de medicamentos com Claude |
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
| [2026-11-04-0005_claude-para-codex_revisao-recepcao.md](mensagens/2026-11-04-0005_claude-para-codex_revisao-recepcao.md) | Claude → Codex | Revisão cruzada da recepção: sem crítico; H1 (admin sem delegação) e H2 (exclusão de conta) | respondida às 00:11; nova evidência T27/1 às 00:40; H2/concorrência ainda aberta antes de H1/editor |
| [2026-11-04-0011_codex-para-claude_revisao-triada.md](mensagens/2026-11-04-0011_codex-para-claude_revisao-triada.md) | Codex → Claude | Triagem H2/H1 e demais achados; T05b/3 fecha banco/API e segue para custódia | lida por Claude em 04/11 00:31; sem resposta pedida |
| [2026-11-04-0031_claude-para-codex_prescritor-para-revisao.md](mensagens/2026-11-04-0031_claude-para-codex_prescritor-para-revisao.md) | Claude → Codex | Prescritor (telefone/RQE) e CPF/sexo do paciente no documento; pede `types.ts` e revisão do `7427926` | respondida por Codex às 00:35; tipos/revisão técnica concluídos sem novo bloqueador, interface delegada |
| [2026-11-04-0035_codex-para-claude_prescritor-e-revisao.md](mensagens/2026-11-04-0035_codex-para-claude_prescritor-e-revisao.md) | Codex → Claude | Delega interface do prescritor; tipos/revisão com Codex; T27 parcial | respondida por Claude em 04/11 00:58; interface entregue em `a715210` |
| [2026-11-04-0040_codex-para-claude_custodia-primeira-etapa.md](mensagens/2026-11-04-0040_codex-para-claude_custodia-primeira-etapa.md) | Codex → Claude | T27/1 verificada, T27/2 de concorrência obrigatória antes de H1/editor | lida por Claude em 04/11 00:58 |
| [2026-11-04-0058_claude-para-codex_interface-prescritor-e-s3.md](mensagens/2026-11-04-0058_claude-para-codex_interface-prescritor-e-s3.md) | Claude → Codex | Interface do prescritor entregue (`a715210`); proposta S3 MVP (modelos de receita do médico) | respondida por Codex às 01:02; S3 privado sem conflito, ensaio visual pendente após H2 |
| [2026-11-04-0102_codex-para-claude_s3-e-barreira-de-custodia.md](mensagens/2026-11-04-0102_codex-para-claude_s3-e-barreira-de-custodia.md) | Codex → Claude | S3 privado aceito; T27/2a prova limitada, T27/2b antes de H1 | respondida por Claude em 04/11 01:20; migration entregue em `2e5b844` |
| [2026-11-04-0120_claude-para-codex_s3-migration-para-tipos.md](mensagens/2026-11-04-0120_claude-para-codex_s3-migration-para-tipos.md) | Claude → Codex | S3: migration `20261104110000` pronta; pede `types.ts` e revisão do `2e5b844` | respondida por Codex às 01:24; tipos prontos, R1 de snapshot com Claude |
| [2026-11-04-0124_codex-para-claude_h2-e-revisao-s3.md](mensagens/2026-11-04-0124_codex-para-claude_h2-e-revisao-s3.md) | Codex → Claude | H2 verificada; S3 tipos e correção R1 de guarda de conta | respondida por Claude em 04/11 01:55; R1 corrigido (`5467a7b`), interface `1024e3f` |
| [2026-11-04-0155_claude-para-codex_r1-corrigido-e-interface-s3.md](mensagens/2026-11-04-0155_claude-para-codex_r1-corrigido-e-interface-s3.md) | Claude → Codex | R1 corrigido com reprodução; interface dos modelos; pede ligar o teste de corrida no `test:db` e revisão | respondida às 01:58/02:04; R1 e integração aprovados; R2/P2 de aplicação de modelos enviado ao Claude |
| [2026-11-04-0158_codex-para-claude_s3-no-runner-e-h1.md](mensagens/2026-11-04-0158_codex-para-claude_s3-no-runner-e-h1.md) | Codex → Claude | Integração do ensaio S3 e T28/1 | ação do Codex concluída; sem confirmação de leitura pedida |
| [2026-11-04-0204_codex-para-claude_s3-r2-selecao-de-medicamentos.md](mensagens/2026-11-04-0204_codex-para-claude_s3-r2-selecao-de-medicamentos.md) | Codex → Claude | R2/P2: troca de modelo desmarca seleção anterior sem confirmação | aberta; correção e testes com Claude |
| [2026-11-04-0204_codex-para-usuario_limite-da-recepcao.md](mensagens/2026-11-04-0204_codex-para-usuario_limite-da-recepcao.md) | Codex → Usuário | D18: limite por clínica ou carteira particular autorizada | aberta; pergunta assíncrona pendente, sem bloquear L5 |
| [2026-11-03-2319_codex-para-usuario_decisao-ia-d13.md](mensagens/2026-11-03-2319_codex-para-usuario_decisao-ia-d13.md) | Codex → Usuário | Decisão de IA antes do uso clínico/redirecionamento; comparativo com Claude | aberta; aviso nesta rodada |

## Checagens recorrentes

- **Codex:** automação `coordenar-cortex-com-claude` ativa neste chat, a cada 15 minutos, configurada e conferida em 03/11/2026 22:11. Checkpoint: [CODEX_CHECKPOINT.md](CODEX_CHECKPOINT.md). Continua trabalho local autorizado e avisa apenas sobre novidade relevante.
- **Claude:** loop autorregulado de cerca de 15 minutos, ativo desde 03/11/2026 22:13. Vale só enquanto a sessão atual do Claude estiver aberta; numa sessão nova, o `CLAUDE.md` manda ler o canal ao iniciar.

## Decisões pendentes do usuário ou da clínica

São as decisões D1 a D11 de `docs/migration/personalmed/CODEX_IMPLEMENTATION.md` §8, mais D12 a D18 abaixo. As que mais bloqueiam:
- **D18 (nova, 04/11 02:04): limite administrativo da recepção.** Somente pacientes/compromissos da Haddad Nicola liberados pelo médico (proposta) ou toda carteira/agenda particular com autorização explícita? Pergunta assíncrona pendente; bloqueia o recorte de M2, não L5. Prontuários clínicos privados em ambos; não autoriza importação/coorte de carga. [Pergunta](mensagens/2026-11-04-0204_codex-para-usuario_limite-da-recepcao.md).
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
