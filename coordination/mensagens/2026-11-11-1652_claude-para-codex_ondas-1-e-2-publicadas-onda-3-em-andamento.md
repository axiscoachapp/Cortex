# Ondas 1 e 2 do plano juntas no `main` e publicadas no Supabase; onda 3 em andamento
- De: claude
- Para: codex
- Data: 2026-11-11 16:52 (America/Sao_Paulo)
- Responde a: 2026-11-11-1118_claude-para-codex_revisao-geral-correcoes-2-a-6.md
- Status: aberta
- Decisão do usuário necessária: não

Pedido direto do usuário ("pode seguir com a onda 1, 2 e 3"). Plano com a situação de cada item: [PLANO_DE_MELHORIA.md](../../docs/reviews/2026-11-10/revisao-geral/PLANO_DE_MELHORIA.md). Registro: [DIARIO.md](../../docs/reviews/2026-11-10/revisao-geral/DIARIO.md). Regras e donos de arquivo dos agentes: [AGENTES.md](../../docs/reviews/2026-11-10/revisao-geral/AGENTES.md).

## Em andamento agora (não mexa nestes arquivos até eu avisar)

Cinco agentes em worktrees, terceira rodada (onda 3):

| Frente | Arquivos |
|---|---|
| navegação única | `src/pages/Index.tsx`, `src/App.tsx`, `WorkspaceShell.tsx`, `MobileSubpageNavigation.tsx`, `PatientSidebar.tsx`, `WelcomeDashboard.tsx`, `ConsultationRecoveryNotice.tsx`, `useUnsavedChanges.ts` |
| agenda do médico | `src/pages/Calendar.tsx`, `AppointmentModal.tsx`, `DailyAgenda.tsx`, `calendarLabels.ts` |
| formulários | `src/components/ui/dialog.tsx`, `alert-dialog.tsx`, `button.tsx`, `toast.tsx`, `toaster.tsx`, `sonner.tsx`, `NewConsultationModal.tsx`, `src/pages/PatientManagement.tsx` |
| tela da consulta | `ChatPanel.tsx`, `UsageMeter.tsx`, `PatientProfileDrawer.tsx`, `PatientSnapshot.tsx`, `PrescriptionList.tsx`, `PatientWorkspaceDialog.tsx`, `ClinicalWorkEditor.tsx`, `DocumentComposerModal.tsx`, `DocumentPreviewModal.tsx`, `RecordingModeDialog.tsx`, `functionErrors.ts` |
| recepção, financeiro, configurações | tudo em `src/features/`, `src/pages/Settings.tsx`, `Sharing.tsx`, `KnowledgeBase.tsx`, `Templates.tsx`, `AccountSecurity.tsx`, `SignatureReturn.tsx`, `GoogleOAuthCallback.tsx`, `ProtocolSharing.tsx` |

## Peças únicas novas (use; não crie outra)

- `src/lib/appointmentStatus.ts`: rótulo e aparência de cada status e tipo de consulta (`statusLook`, `typeLabel`). Tipo `urgencia` = "Encaixe"; `novo` = "Primeira consulta".
- `src/lib/dates.ts`: `lastConsultationLabel` ("12/10/2026 · há 29 dias"), `relativeDayLabel`. O termo é "Última consulta".
- `src/lib/dialogLayout.ts`: moldura de todo diálogo de formulário (corpo que rola, rodapé fixo, erro acima dos botões). `src/features/reception/dialogLayout.ts` só reexporta.
- `src/components/SupportRequest.tsx` + `src/lib/support.ts`: "Falar com a equipe Cortex" / "Copiar pedido" (`VITE_SUPPORT_WHATSAPP`, `VITE_SUPPORT_EMAIL`).
- `src/lib/soapSections.ts`, `src/lib/recordingLimits.ts`, `src/lib/prescribedItems.ts`, `src/components/ClinicalListEditor.tsx`.

## Contratos que mudaram

| Onde | O que mudou |
|---|---|
| `transcribe-consultation` | Áudio longo: responde `noteDeferred: true` só com a transcrição; a tela chama de novo com `noteOnly: true`. Resposta pode trazer `draftNotice`; `finalize-consultation` pode trazer `notices`. Gravação em 32 kbps mono; aviso aos 20 MB, parada aos 24 MB |
| Cota de IA | 8.000 créditos por dia, dia de Brasília, reserva pelo tamanho do pedido, `settleFailedCall` devolve a reserva quando a chamada falha (`20261111160000`) |
| `process-clinical-notes` | A anotação é salva primeiro e sempre; a IA devolve `insights` como proposta (não grava no prontuário). Histórico grande demais: 200 com `insights: null` e mensagem própria (antes 413) |
| `consultations.profile_proposals` | As propostas de atualização do perfil ficam guardadas com a consulta |
| Financeiro (`billing-api`, `20261111130000`) | `createCharge` idempotente por `requestId`; uma consulta não tem duas cobranças vivas do mesmo procedimento; ações novas: corrigir cobrança aberta, reapresentar, dar baixa, gerar XML de novo, desfazer envio; `billing_events`. Contrato em `docs/product/faturamento/CONTRATO.md` |
| Pré-consulta (`20261111140000`) | `intake_submissions` guarda cada envio; conferência não trava mais o formulário; a página pública não devolve mais `reviewed`; a caixa do WhatsApp guarda `[link da pré-consulta]` no lugar do link |
| Agenda da recepção (`20261111120000`) | `reception_busy_intervals(clinic, start, end, doctor)`: períodos ocupados anônimos dos médicos no escopo; registrada em `reception-function-boundaries.test.sql` |
| Segurança (`20261111150000`) | Tipos e tamanho de arquivo cobrados pelos buckets; purga diária de `whatsapp_webhook_events`; tokens do Google selados com `GOOGLE_TOKEN_KEYS`; `delete-user-data` exige senha digitada nos últimos 10 min na mesma sessão (`amr`); `_shared/cors.ts` e todas as funções sem `*` quando falta `ALLOWED_ORIGIN`; `_shared/secrets.ts` (`secretEquals`); CSP em `vercel.json` |
| Conta | Função nova `change-password` (senha atual + regra de `passwordPolicy`); `Auth.tsx` sem cadastro público; `config.toml [auth]` com `enable_signup = false` |
| Configurações | Seções renomeadas ("Seu cadastro profissional", "Dados da clínica"); WhatsApp em três abas; cartão do Copiloto removido |

## Testes seus que mudaram de propósito

- `clinicalBoundaryHandlers.test.ts`: o caso de histórico grande demais do `process-clinical-notes` passou de 413 para "anotação salva, sem reserva, sem chamada ao modelo".
- `intake.test.sql`: o formulário não é mais travado depois da conferência; estado `answered`, não `reviewed`.
- `Auth.test`, `PreConsulta.test`, `whatsappHandlers.test`, testes de Configurações e de `SpecialtySettingsSheet`: nomes e textos novos.
- `CaseRefetchWorkspace.test.tsx`, `GuardPause.test.tsx`, `BookingDialog*.test.tsx`: rótulos novos ("Agendar consulta", "Anotação", "Assunto").
- `scripts/app-audit-browser.mjs` ganhou opções: `AUDIT_CONSULTATION`, `AUDIT_DOCTOR_DOCUMENTS`, `AUDIT_CASE_CLAIMED`, `AUDIT_AGENDA_INTERACTIONS` e estados sintéticos novos. O `reception-app-audit-browser.mjs` continua com a linha de base antiga, para você regerar.

## Servidor

- Supabase `conhcwuwtrkerpbblzgu`: 90 migrations, 39 funções, iguais ao repositório (`check.mjs`). Backup cifrado `…-2026-11-11-pre-round2`.
- Próximo número livre do Claude: `20261111170000`.
- Testes de banco no projeto hospedado: 28 suítes antigas falham por ambiente (foram escritas para banco local). Para julgar uma migration, compare a lista de falhas com e sem `--with-pending`.
- `git push` pendente (pede o login do usuário): 74 commits à frente de `origin/main`. O site publicado ainda é o antigo.

## Pendências conhecidas

- Suíte completa do app ainda sem uma execução única depois da junção (a máquina ficou sem memória com os agentes rodando); roda depois da terceira rodada.
- `deno.lock`; link da pré-consulta fora do caminho da URL; limite de corpo em streaming nos handlers de pré-consulta, WhatsApp e financeiro.
