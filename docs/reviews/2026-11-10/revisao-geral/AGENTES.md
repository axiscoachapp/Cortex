# Instructions for the engineers working on the improvement plan

Read this whole file before touching anything. It applies to every agent working on the plan in [PLANO_DE_MELHORIA.md](PLANO_DE_MELHORIA.md). The lead (Claude) merges your branch with the others, runs the full checks and publishes. Several engineers work in parallel on other areas, so stay inside the files your brief gives you.

## Product in one paragraph
Cortex is a clinic system in Brazilian Portuguese: React 18 + Vite + TypeScript + Tailwind/shadcn + TanStack Query; Supabase Postgres (RLS), Auth and Edge Functions in Deno. Roles: the doctor (private clinical record; records the consultation and the AI drafts the note), the reception (queue, WhatsApp inbox, team agenda, contacts), the clinic admin (team, finance). The pilot is a private gynecology practice. Not launched; the hosted project holds test data only. The technical setup of each clinic (TISS data, health plans, prices, prescriber data, WhatsApp connection) is done by the Cortex team by design: do not add clinic-side editors for it.

## Your workspace
1. You are in an isolated git worktree. It is created from an OLD branch. First run `git log -1 --oneline` and `git branch --show-current`; then, with no changes yet, run `git reset --hard main` so your branch starts at the current `main`. Use `git -c core.longpaths=true` if a git command complains about long paths.
2. There is no `node_modules`. Do not run `npm install`. From the worktree root (PowerShell): `New-Item -ItemType Junction -Path node_modules -Target 'E:\Work\Cortex\cortex\node_modules'`. Do not delete it when you finish.
3. Never modify the main checkout `E:\Work\Cortex\cortex`. Scratch files and screenshots go only under `E:\Work\cortex-audit-tmp\round3\<your-name>\`.
4. Checks: `npx vitest run <focused paths>` (the whole suite takes 25 minutes and the machine is shared: run focused files, and the folder of your area once at the end), `npm run typecheck`, `npx eslint <changed files>`, and `npm run typecheck:edge` if you touched `supabase/functions`.
5. No Docker. No `supabase` CLI. No deploy. No `git push`. Do not read `.env*` files or any secret. No calls to OpenAI, Meta or the deployed site.
6. Database: only if your brief gives you a migration number. One new additive file `supabase/migrations/<number>_<name>.sql` (applied migrations are immutable; change functions with `create or replace`, keeping grants and `search_path`; header comment says owner Claude, what and why) plus `supabase/tests/<name>.test.sql`. Prove it with `node scripts/supabase-rollout/sqltest.mjs --project conhcwuwtrkerpbblzgu --with-pending <test files>`: it runs your pending migration and the tests on the hosted TEST project inside a transaction that is always rolled back. That is the only database access allowed; never `migrate.mjs`, `backup.mjs` or anything that persists. Also run the existing suites your change could affect, and if one fails, run it without your migration to see whether the failure is yours.
7. Visual checks (required for UI work): `node scripts/app-audit-browser.mjs --only "/route,/route"` runs the app on a local Vite server with a fully synthetic backend. Read the script header. Set `CORTEX_BROWSER_ARTIFACTS` to a folder under your scratch path; useful options: `AUDIT_CLINIC_ADMIN=1`, `AUDIT_WORKSPACE_ROLE=doctor|admin|reception`, `AUDIT_LAPTOPS=1` (adds 1366×768, 1536×864, 1280×800), `AUDIT_WORKSPACE_INTERACTIONS=1`. Extend its synthetic data or interactions when you need a state it does not reach (keep additions small and committed with your work). Open the PNGs with the Read tool and really look, at 1366×768 and 375×812 at least.

## Quality bar
- Fix the cause, not the symptom. Keep the existing safety properties: server-side authorization is the boundary; never show or act on another actor's data; optimistic concurrency by revision stays.
- Every behaviour you change gets a regression test (Vitest + Testing Library, next to the existing tests of that file). Existing tests that encode the old behaviour are changed deliberately; list each in your report with the reason.
- Layout: the app frame is desktop from 1200 real pixels (`shell:` Tailwind screen, `SHELL_BREAKPOINT` in `src/lib/interfaceScale.ts`); the type scale is 135% and the content screens `sm…2xl` are scaled by 1.35. Phone layout below ~1037 px. No horizontal page scroll at 320–1920.
- Dialogs: title equals the trigger label, body scrolls, footer fixed with "Cancelar" then the primary action on the right, errors shown directly above the footer and focused. Validation messages under the field, not in a toast.
- Accessibility: every control named, labels linked to fields, 44 px targets on the phone, live regions for async results, focus returned after dialogs.
- Text for users: Brazilian Portuguese, short, plain, saying what happened and what to do next. Sentence case ("Nova consulta", not "Nova Consulta"). No internal jargon: avoid "implantação", "vínculo", "demanda", "leitura", "escopo", "fluxo", "fresco", revision/verification wording. Say "equipe Cortex" for our team. Where a screen shows data only the Cortex team changes, use the shared `<SupportRequest subject="…" />` (`src/components/SupportRequest.tsx`) instead of a sentence with no way to act.
- Code comments and commit messages in English; comments only where they explain a rule or a reason.
- Do not refactor beyond your items. Keep diffs focused.

## Round 3 (experience and consistency) — who owns what

Round 2 below is merged. Round 3 closes wave 3 of the plan. The findings are numbered in [relatorios/ux-medico-paginas-publicas.md](relatorios/ux-medico-paginas-publicas.md) ("M n") and [relatorios/ux-recepcao-financeiro-configuracoes.md](relatorios/ux-recepcao-financeiro-configuracoes.md) ("R n"). Much of each report was already fixed in rounds 1 and 2: **check the current code and screen first, fix only what is still true**, and say "already done" for the rest. The screenshot paths in the reports are the reviewer's; make your own. Scratch folder: `E:\Work\cortex-audit-tmp\round3\<your-name>\`.

Shared pieces that already exist — use them, do not make a second one:
- `src/lib/dialogLayout.ts`: the frame of every form dialog (header, scrolling body, fixed footer, error above the buttons). The reception booking dialog is the reference use.
- `src/lib/appointmentStatus.ts`: label and look of each appointment status and type (`statusLook`, `typeLabel`). No screen keeps its own map.
- `src/lib/dates.ts`: `lastConsultationLabel` ("12/10/2026 · há 29 dias"), `formatDateOnly`, `relativeDayLabel`. The term is "Última consulta".
- `src/components/SupportRequest.tsx`: "ask the Cortex team" with a way to do it.
- Words agreed for this round: "Iniciar atendimento" (start a visit now, button and dialog title), "Novo agendamento" / "Editar agendamento", "Escrever evolução", "Pendências e retornos", "Última consulta", "E-mail", "(opcional)" as the only optional mark, "Sair" → asks "Sair da conta?".

| Agent | Files | Findings |
|---|---|---|
| navegacao | `src/pages/Index.tsx`, `src/App.tsx`, `src/components/WorkspaceShell.tsx`, `MobileSubpageNavigation.tsx`, `PatientSidebar.tsx`, `WelcomeDashboard.tsx`, `ConsultationRecoveryNotice.tsx`, `src/hooks/useUnsavedChanges.ts`, new navigation/sign-out/unsaved-changes components | M 7, 8, 19, 22, 23, 24 (sidebar and home), 25 (home), 28, 33, 34 (loaders); R 8, 32 |
| agenda-medico | `src/pages/Calendar.tsx`, `src/components/AppointmentModal.tsx`, `DailyAgenda.tsx`, `src/lib/calendarLabels.ts`, the waitlist and calendar components used only by the doctor's agenda | M 5, 9 and 10 (appointment dialog), 13 (agenda), 24 (agenda), 28 (agenda card), 30 |
| formularios | `src/components/ui/dialog.tsx`, `alert-dialog.tsx`, `button.tsx`, `toast.tsx`, `toaster.tsx`, `sonner.tsx`, `NewConsultationModal.tsx`, `src/pages/PatientManagement.tsx` and the patient form/import components it uses | M 9, 10, 11 (where toasts appear), 13 (start-visit dialog), 14 (what is left), 25 (list), 34 (close target, list loading, empty search); R 34 |
| consulta-tela | `src/components/ChatPanel.tsx`, `UsageMeter.tsx`, `PatientProfileDrawer.tsx`, `PatientSnapshot.tsx`, `PrescriptionList.tsx`, `PatientWorkspaceDialog.tsx`, `ClinicalWorkEditor.tsx`, `DocumentComposerModal.tsx`, `DocumentPreviewModal.tsx`, `RecordingModeDialog.tsx`, `src/lib/functionErrors.ts` | M 3, 11 (consultation and composer errors inline), 12, 13 (consultation), 15, 25 (profile), 26, 27, 32 (composer), 34 (dose field) |
| recepcao-financeiro | everything under `src/features/` (reception, billing, settings, intake), `src/pages/Settings.tsx`, `Sharing.tsx`, `KnowledgeBase.tsx`, `Templates.tsx`, `AccountSecurity.tsx`, `SignatureReturn.tsx`, `GoogleOAuthCallback.tsx`, `src/components/ProtocolSharing.tsx` | R 11, 12, 19, 23, 24, 26, 29, 30, 31, 33, 35 and whatever is still true of R 9, 10, 13–18, 20–22, 27, 28; M 29, 32 (these pages) |

Every agent also fixes M 31 (sentence case, "(opcional)", "E-mail", one name per page) inside its own files.

Rules for the shared edges of this round:
- `ChatPanel.tsx` belongs to consulta-tela. navegacao places the Consulta/Perfil switch from `Index.tsx` and does not edit `ChatPanel.tsx`.
- `scripts/app-audit-browser.mjs` is edited by several agents: add options at the end of the options comment and synthetic data in your own clearly named block; do not reformat or reorder what is there.
- No database or Edge Function changes in this round. If a finding needs one, describe it in your report instead.

## Round 2 — who owned what (merged; kept for history)
| Agent | Files |
|---|---|
| clin-consulta | `src/components/ChatPanel.tsx`, `src/pages/Index.tsx`, `PatientSidebar.tsx`, `WelcomeDashboard.tsx`, `CommentProposalCard.tsx`, `PrescriptionList.tsx`, `RecordingModeDialog.tsx`, `UsageMeter.tsx`, `src/hooks/useRecording.ts`, `src/lib/recordingRescue.ts`, `src/lib/functionErrors.ts` |
| clin-documentos | `ClinicalWorkEditor.tsx`, `SoapNoteView.tsx`, `src/lib/printDoc.ts`, `PatientSnapshot.tsx`, `PatientProfileDrawer.tsx`, `DocumentComposerModal.tsx`, `DocumentPreviewModal.tsx`, `ClinicalProposals.tsx`, `ImportPatientsModal.tsx`, `src/pages/Templates.tsx`, `src/pages/PatientManagement.tsx`, `src/pages/ClinicalWorkspace.tsx`, `supabase/functions/process-clinical-notes/` |
| rec-agenda | `src/features/reception/BookingDialog.tsx`, `ReceptionCalendar.tsx`, `ReceptionAppointmentCard.tsx`, `ContactSearch.tsx`, `NewCaseDialog.tsx`, `appointmentTiming.ts`, `dates.ts`, new agenda components; migration `20261111120000` |
| rec-fila | `src/features/reception/ReceptionQueue.tsx` (the `CaseQueue` part), `CaseWorkspace.tsx`, `DoctorSuggestion.tsx`, `ContactsPage.tsx`, `ContactDirectory.tsx`, `TeamSettings.tsx`, `DelegationPermissions.tsx`, `StaffAccessProvenance.tsx`, `ReceptionDashboard*.tsx`, `whatsappDashboard.ts`, `WhatsAppInbox.tsx`, `WhatsAppMessages.tsx`, `WhatsAppQueueAction.tsx`, `ReceptionNotice.tsx` |
| financeiro | `src/features/billing/*`, `supabase/functions/_shared/billing*.ts`, `tiss.ts`, `supabase/functions/billing-api/`, `docs/product/faturamento/`; migration `20261111130000` |
| pre-consulta-conta | `src/features/intake/*`, `src/pages/PreConsulta.tsx`, `supabase/functions/_shared/intake*.ts`, `supabase/functions/intake-*/`, `src/pages/Settings.tsx`, `src/features/settings/*`, `SpecialtySettingsSheet.tsx`, `src/pages/Auth.tsx`, `AccountSecurity.tsx`, `DataPrivacy.tsx`, `src/lib/dataExport.ts`, the `[auth]` part of `supabase/config.toml`; migration `20261111140000` |
| ia-servidor | `supabase/functions/_shared/clinicalAi.ts`, `quota.ts`, `clinicalQuestionSafety.ts`, `http.ts`, `specialty_prompts.ts`, `gemini.ts`, and the functions `transcribe-consultation`, `finalize-consultation`, `chat-assistant`, `generate-prebriefing`, `suggest-questions`, `generate-document`, `analyze-document`, `create-template-ai`, `ingest-knowledge`, `process-comment`; migration `20261111160000` |
| seguranca | `vercel.json`, `supabase/functions/refresh-*`, `validate-prescription`, `google-oauth-*`, `sync-google-calendar`, `delete-user-data`, `_shared/oauth.ts`, `_shared/whatsappDeps.ts` (CORS only), `src/components/PatientFiles.tsx`, `deno.lock`; migration `20261111150000` |

`src/features/reception/api.ts` is shared by rec-agenda and rec-fila: add methods at the end of the object, do not reorder or reformat.
`supabase/functions/_shared/whatsappHandlers.ts`: pre-consulta-conta may change only how the automation stores the pre-consultation link; seguranca may change only the secret comparison.

## Deliver
- Commit on your worktree branch: `git add -- <path> <path>…` path by path (never `-A` or `.`); one commit per coherent piece is fine; conventional English messages that say what changed for the user and why; end each with the attribution line your environment gives you (if none: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Backup patch: `git format-patch main --stdout > E:/Work/cortex-audit-tmp/round3/<your-name>/<your-name>.patch`.
- Final message (it is all the lead sees; keep it under 60 lines): summary in 3 lines; for each item of your brief: done / partly / not done, and the behaviour now in one line; changed test expectations with reasons; checks run with numbers; SQL suites run (if any) with pass/fail; what could not be verified; anything risky for the merge (files touched outside your list); deployment steps if any; branch name and commit SHAs.
