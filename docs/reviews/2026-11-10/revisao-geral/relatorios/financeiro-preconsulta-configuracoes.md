# Relatório do revisor: Financeiro, pré-consulta e configurações

Revisor independente, sem o contexto da conversa principal, só para leitura. Texto original do revisor (em inglês), de 11/11/2026. Os caminhos em `E:\Work\cortex-audit-tmp\` são arquivos de trabalho fora do repositório.

---

A new clinic cannot get started today: every piece of technical setup that `3aefdf2`/`bf47950` made read-only has no remaining writer, and no operator tool exists. The first plan (convênio) charge, the first TISS batch, the WhatsApp connection and a new doctor's first prescription are all blocked; the server actions still exist and the removed forms are one commit back. Private charges, the pre-consultation form editor, cash/expenses and reports still work from the UI. Beyond that I confirmed one money defect (a charge is inserted and then answered 400, so a retry duplicates it) and several recovery/data-loss problems in the dialogs.

Verification: the 12 existing test files (87 tests) pass, and my 12 repro tests pass (they assert the defective behaviour). The synthetic browser audit as admin at 1280 and 375 px had no automatic findings. Findings marked CONFIRMED without "repro" are from reading the code.

## A. Can a new clinic get started?

| Item | Needed for | Stored in | Who can create/edit it today |
|---|---|---|---|
| `INTAKE_LINK_SECRET`, `INTAKE_APP_URL` | (a) any link | Edge env | Deployment only (correct). Screen says "não foi configurada no servidor". |
| Pre-consultation form and on/off | (a) | `intake_forms` | Admin: Configurações → Perguntas da pré-consulta. Works. |
| Appointment on the clinic agenda, in the actor's scope | (a), (b) "A faturar" | `appointments.clinic_id`, `staff_doctor_scopes` | Reception agenda and doctor delegation (not my area). Appointments a doctor books in `/agenda` carry no `clinic_id` and never appear (finding 11). |
| Patient WhatsApp opt-in | (a) automatic sending | `whatsapp_opt_ins` | The pre-consultation checkbox itself. A first-time patient gets the link only by manual copy. Other opt-in paths not verified. |
| Clinic TISS data (razão social, CNPJ, CNES) | (c); razão social is mandatory for SP/SADT | `billing_settings` | **None.** `saveSettings` exists, admin-only, no caller in `src`. |
| Health plans (ANS registry, provider code, TISS version, hash, ZIP, deadlines) | (b) plan charges, (c) | `billing_payers` | **None.** `savePayer` has no caller. Lotes shows only "Solicite à equipe Cortex…". |
| Price table | (b) convenience; without it every charge is typed by hand | `billing_prices` | **None.** `savePrice`/`deletePrice` have no caller. |
| Doctor TISS identity (council, number, UF, CBO) | (c): XML refused with code `professional` without it | `billing_professionals` | **None.** `saveProfessional` has no caller. |
| Payout share % | Reports (repasse) | `billing_professionals.share_percent` | **None.** |
| Patient plan card | (b) prefill | `billing_coverages` | Saved automatically when a charge is created from an appointment. |
| Doctor name, CRM | Labels in finance, public page, WhatsApp | `user_settings` | Set once when the admin creates the doctor (`create-clinic-doctor`). No edit afterwards. |
| Professional address, phone, RQE, CPF, specialty | Prescriptions (address is mandatory) | `user_settings` | **None.** The hook now writes only `active_template_id`; the RPC still accepts the other keys. |
| WhatsApp server secrets | (d) | Edge env | Deployment only (correct). |
| WhatsApp connection (number ID, WABA ID, token, PIN) | (d) everything | `whatsapp_channels` | **None.** `connect`/`disconnect` exist, admin-only, form removed in `bf47950`. |
| Templates | (d) | Meta, then synced | Admin "Sincronizar modelos", only once connected. |
| Automations, menu bot | (d) | `whatsapp_automations`, flow | Admin, only once connected. |
| Expenses, private payments | Cash | `billing_expenses`, `billing_payments` | Admin / reception. Works. |

Result per goal:
- **(a) Pre-consultation link:** reachable (admin enables the form, reception copies the link), given the two secrets.
- **(b) Charge:** private only, typed by hand; a plan charge is impossible.
- **(c) TISS batch:** impossible.
- **(d) WhatsApp:** impossible.

## B. Findings

1. `[P1] [CONFIRMED] Billing registrations cannot be created from any screen` — `src/features/billing/SetupTab.tsx:8-70`; `BatchesTab.tsx:223-225`; `_shared/billingHandlers.ts:251-313`, `:576`.
   - What happens: the admin opens Financeiro → Cadastros and finds text only. With no payer the "Convênio" select holds only "Particular" and Lotes is a single sentence. If someone seeds a payer, "Baixar XML" then fails with "Cadastre conselho, número e CBO…" and there is nowhere to do it.
   - Evidence: no `saveSettings|savePayer|savePrice|deletePrice|saveProfessional` call in `src`; `3aefdf2^` had all five; tables grant only `service_role`; `Plano de implementação.md:177-178` lists the operator procedure as pending.
   - Fix: restore the editors from `3aefdf2^:src/features/billing/SetupTab.tsx` for the clinic admin (the server already enforces admin and revision), keeping the "prepared with Cortex" note, until an operator tool exists.
   - Effort: S to restore, L for an operator tool.

2. `[P1] [CONFIRMED] WhatsApp cannot be connected` — `src/features/settings/WhatsAppSettings.tsx:98-134`; `_shared/whatsappHandlers.ts:313-314, 365-398`.
   - What happens: a new clinic sees "Nenhum número conectado… A equipe de implantação conecta". Templates, bot, automations and inbox are all gated on `connected`.
   - Evidence: the client calls only `state, templates, automations, flow, syncTemplates, saveAutomation, saveFlow, deleteAutomation`; `bf47950^` called `connect` and `disconnect`.
   - Fix: restore the connect/disconnect form for the admin, or build the operator path first.
   - Effort: S.

3. `[P1] [CONFIRMED] A new doctor's prescriber data has no editor, and prescriptions are refused without it` — `src/hooks/useUserSettings.ts:86-91`; `src/features/settings/ClinicSetupSummary.tsx:21-26`; `supabase/functions/generate-prescription/index.ts:134`.
   - What happens: account creation sets name and CRM only. The prescription function refuses when `professional_address` is empty; phone and CPF are needed for antimicrobial and C5 prescriptions. The screen says "Nenhum dado é alterado nesta tela".
   - Evidence: `update_user_settings` (`20261104130000:36-70`) still accepts these keys from the doctor; the form existed in `bf47950^:ProfessionalSettingsForm.tsx`.
   - Fix: restore the prescriber form for the doctor.
   - Effort: S.

4. `[P2] [CONFIRMED, repro] createCharge inserts the charge and then answers 400; each retry inserts another` — `_shared/billingHandlers.ts:385-388`.
   - What happens: `date(body.cardValidUntil, …)` is evaluated after `insertCharge`, outside the `.catch`. A validity that is not `YYYY-MM-DD` returns "Validade: valor inválido." with the row already written.
   - UI path: the form editor lets the admin set the "Validade da carteirinha" question to "Texto curto". The patient types `12/2027`, `seedFrom` forwards it (`billingLogic.ts:30`), the date input renders empty, and every "Salvar cobrança" adds a charge. With the starter form (type date) this does not trigger.
   - Evidence: `handler.repro.test.ts` (400, 1 row; second attempt, 2 rows) and `ui.repro.test.tsx`.
   - Fix: parse every field before `insertCharge`; in `seedFrom` drop a validity that is not ISO; restrict that field to type `date` in `validateForm`.
   - Effort: S.

5. `[P2] [CONFIRMED, repro] A stale-revision refusal has no recovery in the finance dialogs` — `ChargesTabs.tsx:94-99`; `BatchesTab.tsx:41-50, 132-137, 194-211`; `CashTab.tsx:36-45`; `App.tsx:51`.
   - What happens: "A cobrança mudou; atualize" appears, but nothing refetches and the dialog keeps its snapshot. Closing and reopening sends the same revision. In "Lançar retorno" the user must also discard every typed line.
   - Evidence: repro shows two `pay` calls with revision 2 and a single `charges` read.
   - Fix: on code `stale`, invalidate `billingKey(scope)` and re-seed the dialog's revision from the fresh row while keeping typed values; show "Atualizar e tentar de novo".
   - Effort: M.

6. `[P2] [CONFIRMED] "Corrigir retorno" erases every paid value and glosa of the batch` — `20261107120000_billing.sql:388-392`; `BatchesTab.tsx:39`.
   - What happens: to fix one typo the admin reopens, all guides go back to zero, and the dialog restarts with every guide "paid in full". Up to 100 lines of denial codes and notes must be retyped; a missed one silently becomes "Paga".
   - Fix: read `batchCharges` before reopening and prefill the lines, or make the server keep the previous values as a draft.
   - Effort: M.

7. `[P2] [CONFIRMED] The batch XML is frozen at the first download and the screen never says so; "Enviado" cannot be undone` — `_shared/billingHandlers.ts:568-572`; `BatchesTab.tsx:289-297`.
   - What happens: the admin downloads to check, finds a wrong CBO or card, gets it corrected, downloads again and receives the same bytes. The only way out is "Desfazer lote" and rebuilding (new batch number), which nothing explains. A batch marked sent by mistake has no way back.
   - Fix: for a draft, offer "Gerar de novo" (clear `xml_hash`/`xml_payload`) with the generation time shown; add `unsend` for a `sent` batch without a statement.
   - Effort: M.

8. `[P2] [CONFIRMED, repro] A private charge demands table and procedure code, and there is no price list to pick from` — `ChargeDialog.tsx:112, 171`; `billingHandlers.ts:373`; `billing.sql:134`.
   - What happens: reception fills patient, description and value and gets "Escolha um procedimento da tabela ou informe código e descrição." The hint says "Solicite a tabela à equipe Cortex".
   - Fix: finding 1 fixes the common case. Also, for "Particular", hide Tabela/Código and send a default (table `00`, a fixed code), or relax the server check for `particular`.
   - Effort: S.

9. `[P2] [CONFIRMED, repro] Pre-consultation form editor, WhatsApp bot editor and automation dialog lose edits without asking` — `IntakeFormEditor.tsx:37-50`; `FlowEditor.tsx:47-60`; `AutomationEditor.tsx:91`.
   - What happens: none registers `useUnsavedChanges`. Changing the section select, "Todas as configurações", the side menu or a reload drops a long edit; Escape or an outside click closes the automation dialog.
   - Evidence: repro shows `confirmSessionExit()` true and `beforeunload` not prevented while dirty; Escape calls `onOpenChange(false)`.
   - Fix: `useUnsavedChanges(dirty, …)` in the two editors; guard the automation dialog as the finance dialogs do.
   - Effort: S.

10. `[P2] [CONFIRMED] "Fale com a equipe de implantação" appears across the app with no way to do it` — `ClinicSetupSummary.tsx:25, 31`; `SetupTab.tsx:14-15`; `WhatsAppSettings.tsx:117-132`; `managedSetupMessages.ts`.
    - Evidence: no `mailto:`, phone or `wa.me` for support anywhere in `src`.
    - Fix: one configurable support contact rendered as a "Solicitar à implantação" action, ideally prefilled with the screen and field.
    - Effort: S.

11. `[P2] [CONFIRMED] "A faturar" silently omits visits booked in the doctor's own agenda and anything from earlier months` — `_shared/billingDeps.ts:151-153`; `AppointmentModal.tsx:231-241`; `ChargesTabs.tsx:43-47`.
    - What happens: a doctor who books in `/agenda` sees "Nenhum atendimento a faturar neste mês" forever. An unbilled visit from 31/10 disappears on 01/11 unless someone pages back.
    - Fix: explain the rule in the empty state with a pointer to "Nova cobrança avulsa"; add a "N atendimentos de meses anteriores sem cobrança" line; decide whether personal appointments should count.
    - Effort: S–M.

12. `[P2] [CONFIRMED] No way to correct a charge; a denied guide is a dead end` — `ChargesTabs.tsx:213-218`; handler has no `updateCharge` action.
    - What happens: a wrong card, code or value means cancel and recreate, and only while open and unpaid. After a glosa the charge stays "Glosada"; the only route is finding 6's "Corrigir retorno".
    - Fix: allow editing while `open`; add "reapresentar" (back to open, keeping the guide number) and "dar baixa" for denied guides.
    - Effort: M.

13. `[P3] [CONFIRMED] Lotes hides existing batches when the clinic has no active plan` — `BatchesTab.tsx:223-225`. The early return precedes the list, so a sent batch awaiting its statement becomes unreachable if the only payer is deactivated. Fix: gate only the "Montar lote" section. Effort: S.

14. `[P3] [CONFIRMED, repro] Pre-consultation → charge prefill rarely matches` — `billingLogic.ts:23-24`. It needs the literal option "Convênio" and the patient typing the plan name exactly as registered. Fix: render the plan question as a choice of the clinic's active payers, or carry the payer id. Effort: M.

15. `[P3] [CONFIRMED] After a refused save the form editor cannot recover` — `IntakeFormEditor.tsx:39-44, 59, 210`. "Descartar mudanças" re-applies the cached read with the old revision; only leaving and returning refetches. `FlowEditor` has the same shape. Fix: refetch on discard and on a `stale` error. Effort: S.

16. `[P3] [SUSPECTED] "Copiar link" may fail on Safari/iOS` — `IntakePage.tsx:136-143`. `clipboard.writeText` runs after the network call; if it is rejected the fallback is a toast with a long URL. Not testable here. Fix: show the link in a dialog with a "Copiar" button when the write is rejected. Effort: S.

17. `[P3] [CONFIRMED] Pré-consultas gives misleading or silent states` — `IntakePage.tsx:126, 159-163, 179, 194-199`.
    - An admin who is not a doctor gets "Nenhuma consulta da agenda da clínica neste período" (the scope rule hides other doctors' agendas).
    - "Criar e copiar link" is offered for past or completed visits and answers with a 400 toast.
    - If the `state` read fails, the buttons vanish with no message.
    - Fix: role-aware empty state, hide the button for past/`realizado`, show the read error. Effort: S.

18. `[P3] [CONFIRMED] createCharge is not idempotent` — `billingHandlers.ts:344-391`. A lost response followed by a retry, or two receptionists on the same row, yields two charges for one appointment (repro NOTE test). Fix: a client idempotency key, or a warning when the appointment already has an open charge with the same code. Effort: S–M.

19. `[P3] [CONFIRMED] Settings polish` — `Settings.tsx:82`: "Contas de médicos" and "Compartilhamento entre médicos" both link to `/compartilhamento`. `Settings.tsx:55`: an unknown or unauthorised `?secao=` falls back to the overview silently. `ClinicSetupSummary.tsx:33`: reception sees the "Copiloto ao vivo" card, which means nothing to them. Effort: S.

20. `[P3] [CONFIRMED] Finance polish` — Effort: S each.
    - `BillingPage.tsx:49`: the `capitalize` class renders "Novembro De 2026".
    - `shared.tsx:39-45`: field hints are not linked with `aria-describedby`; dialog errors are one alert at the bottom with no `aria-invalid` or focus on the field.
    - `CashTab.tsx:162`: a batch receipt reads "Pagamento de lote do convênio" without plan or batch number.
    - `BatchesTab.tsx:76-100`: the statement dialog has no filter by guide number.
    - At 375 px the heading, period card and six tabs fill the first screen before any content.

**On the flow for a non-specialist manager:** the tab order follows the work and the wording is plain, but nothing says what comes next. After "Cobrança registrada" for a plan there is no pointer to Lotes; "Em aberto → Em lote → Enviada → Paga/Glosada" is never explained; the XML step is a toast. A one-line "próximo passo" under each tab title would help.

## C. Checked and OK / Not covered

**Checked and OK**
- Month boundaries follow America/Sao_Paulo (`monthRange` at 30/11 23:30 BRT, and the server date windows).
- `parseMoney` refuses ambiguous input (`1.500`, `1,234.56`).
- Totals and rounding in charges, statement, cash and reports; payout is computed on the amount received.
- Double submit is blocked by refs and disabled fieldsets in every finance dialog.
- The `3aefdf2` draft protection behaves in the finance dialogs (existing 7 tests) and does not block legitimate navigation there.
- Role gating matches the server for every action the UI offers (admin, reception, doctor).
- Server features now have UI: `reopenBatch`, `updateBatch` (NFS-e only; `notes` has none), expenses, `cancelPayment`.
- Public pre-consultation page: open / answered (warning, empty form) / reviewed / closed / invalid link / server not ready; conditional chains; required fields; hidden answers not sent; resubmission. A second Enter while sending is not a defect, because the submit button is disabled.
- The legacy-copilot guard is effective: `useUserSettings.ts:112` forces `false` and is the only consumer.
- WhatsApp settings read "server not ready" and "not connected" clearly; the only gap is finding 2.
- Browser audit as admin, 1280 and 375 px, on `/financeiro` (all tabs and dialogs the script opens), `/pre-consultas` and six settings sections: no overflow, unnamed controls, unlabelled fields or console errors.

**Not covered**
- Nothing was run against a real database: SQL functions, RLS/grants and concurrency were read, not executed.
- TISS XML validity against the XSD (I only confirmed `tiss.test.ts` passes).
- The reception and doctor roles in the browser, 1920 px, keyboard-only and screen-reader passes.
- Safari clipboard behaviour (finding 16).
- The 100-guide statement dialog at real size.
- The WhatsApp webhook and automation scheduler beyond what settings needs; `TeamSettings` and `DelegationPermissions`.
- Whether the reception agenda always sets `status`; a checked-in row with null status would be excluded from "A faturar" (`billingDeps.ts:153`).
- I did not answer the open coordination messages addressed to `claude`, because this task is read-only on the repository.

Scratch files are in `E:\Work\cortex-audit-tmp\review\finance\`:
- `vitest.config.mjs`
- `handler.repro.test.ts`
- `ui.repro.test.tsx`
- `browser-admin\` (screenshots and `audit.json`)
