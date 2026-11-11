# Relatório do revisor: Recepção (funções)

Revisor independente, sem o contexto da conversa principal, só para leitura. Texto original do revisor (em inglês), de 11/11/2026. Os caminhos em `E:\Work\cortex-audit-tmp\` são arquivos de trabalho fora do repositório.

---

## Reception workspace review — final report

**Summary.** The queue, contacts and agenda adapters match the server, and double submits are well guarded. Three things stop daily work:
- The WhatsApp inbox is read-only: there is no way to answer a conversation, and it never refreshes on its own.
- The "retire on any doubt" guards discard typed work in normal operation: on every access-token refresh, on one failed 15 s access poll, and on one failed 15 s case refetch. I reproduced all three with scratch tests.
- Scheduling is blind: the booking dialog shows no availability, and the team agenda hides the doctor's own appointments, which still block the slot.

Repro tests (4 passing) are in `E:\Work\cortex-audit-tmp\review\reception\tests\`. Run them from the repo with `npx vitest run --config E:/Work/cortex-audit-tmp/review/reception/vitest.config.mts`. Screenshots are in `E:\Work\cortex-audit-tmp\review\reception\shots-reception\`. I did not edit the repo.

## Findings

**1. [P1] [CONFIRMED] The receptionist cannot answer a WhatsApp conversation**
- Where: `E:\Work\Cortex\cortex\src\features\reception\whatsappApi.ts:1` ("K1 read-only boundary"); `WhatsAppMessages.tsx` has no composer; `WhatsAppTemplateCatalog.tsx` only displays templates.
- What goes wrong: she can read, assume, transfer and close a conversation, but cannot send free text inside the 24 h window or a template outside it.
- Evidence: no client code calls `action:'send'`, `mark_read`, `media`, `link_contact`, `link_case` or `record_opt_in` (grep of `src`). The server implements them in `E:\Work\Cortex\cortex\supabase\functions\_shared\whatsappHandlers.ts:324`, `:433-492`, `:498-519`.
- Side effects: the unread badge only clears when the conversation is closed, and the dashboard's "Com envio humano" can never rise.
- Fix: add a composer to `WhatsAppMessages` for the user's own open conversation.
  - Free text while `windowOpenUntil` is in the future; otherwise a template picker with one input per `paramCount`.
  - `requestId` from `useRequestId`; handle `window_closed`, `opted_out`, `template`, `send_failed` and the 202 `unknown` warning.
  - Call `act mark_read` when the owner opens the conversation.
- Effort: L.

**2. [P1] [CONFIRMED] The inbox never refreshes by itself**
- Where: `E:\Work\Cortex\cortex\src\features\reception\WhatsAppInbox.tsx:35`, `:79`; `WhatsAppMessages.tsx:28`.
- What goes wrong: new conversations and messages appear only after clicking "Atualizar conversas" or "Atualizar mensagens". A patient can wait unseen.
- Evidence: no `refetchInterval`; `refetchOnWindowFocus:false`; `refetchOnReconnect:false`. The contract says the inbox polls every few seconds (`E:\Work\Cortex\cortex\docs\product\whatsapp\CONTRATO.md:163`).
- Fix: poll the list and the open conversation every 10–15 s, paused while a command runs. Two things must change first, or each tick will blank the list and remount the open conversation:
  - `fresh` requires `fetchStatus==='idle'` (`WhatsAppInbox.tsx:81`); keep showing the previous data during a background refetch.
  - The detail key includes `list.data.readVersion` (`WhatsAppInbox.tsx:169`); decouple it.
- Effort: M.

**3. [P1] [CONFIRMED, reproduced] Every access-token refresh discards an open "Novo atendimento" or "Corrigir contato"**
- Where: `E:\Work\Cortex\cortex\src\components\SessionAssurance.tsx:108`, `:124`, `:156`; `E:\Work\Cortex\cortex\src\contexts\AuthContext.tsx:42-46`; `E:\Work\Cortex\cortex\src\features\reception\NewCaseDialog.tsx:49-59`, `:111-121`; `ContactCorrectionDialog.tsx:29-35`, `:93-100`.
- What goes wrong: the dialog is replaced by "A verificação deste atendimento foi interrompida… Fechar esta janela descarta o preenchimento", for good. The whole app also flashes "Verificando sessão…".
- Cause: the assurance query key contains `session.expires_at`. On refresh the new key has no data, so the workspace is reported hidden for at least one render, and the dialogs treat that as permanent invalidation.
- Also reset by the same event: the contact directory search and pages (`ContactDirectory.tsx:22`), the dashboard period (`ReceptionDashboard.tsx:30`), the links dialog (`ContactLinksDialog.tsx:20`) and the transfer picker (`WhatsAppTransferAction.tsx:17`).
- Evidence: `tests\guard-token-refresh.test.tsx`, test A. `autoRefreshToken` is on; the refresh is hourly with Supabase defaults (I did not check the hosted project's JWT expiry).
- Fix:
  - `SessionAssurance`: drop `expires_at` from the key and refetch on change, or keep `allowed` for the same actor while the new key loads.
  - Dialogs: treat `hidden` as a pause (disable submit); invalidate only on actor, clinic or role change.
- Effort: S for `SessionAssurance`, M for the dialogs.

**4. [P1] [CONFIRMED, reproduced] One failed 15 s `clinic_access` poll blanks the reception workspace and kills open dialogs**
- Where: `E:\Work\Cortex\cortex\src\features\reception\ClinicAccessGate.tsx:28-49` (`retry:false`, `refetchInterval:15_000`), `:51-59`, `:123-136`.
- What goes wrong: a single network blip puts a full-screen "Verificação de acesso" over everything under `/recepcao`. When the next poll succeeds the page returns, but "Novo atendimento" and "Corrigir contato" stay invalidated as in finding 3.
- Evidence: `tests\guard-token-refresh.test.tsx`, test B. A successful background refetch does not blank anything.
- Fix:
  - Retry transport errors two or three times.
  - Block only after about 45–60 s without a verified read.
  - Until then show the non-blocking banner already used for the clinical pages (`continueClinical`). Every RPC is still authorised by the server.
- Effort: S–M.

**5. [P2] [CONFIRMED, reproduced] One failed 15 s refetch of the selected case closes the booking dialog and loses unsaved draft text**
- Where: `E:\Work\Cortex\cortex\src\features\reception\ReceptionQueue.tsx:49-55`, `:164` (`detail.data && !detail.isError`).
- What goes wrong: `CaseWorkspace` unmounts. An open "Confirmar agendamento" vanishes with everything filled in, and no unsaved-changes prompt appears. Text typed since the last 600 ms pause in "Seu rascunho de acompanhamento" is never saved. A booking in flight loses its result message.
- Evidence: `tests\case-refetch-unmount.test.tsx`, C1 and C2.
- Fix:
  - Render `CaseWorkspace` whenever `detail.data` exists, with the error as a banner.
  - Flush the draft in `useCaseDraft` cleanup when `latest !== saved`.
- Effort: S.

**6. [P2] [CONFIRMED from code and contract] The team agenda hides the doctor's own appointments, yet they block booking**
- Where:
  - `E:\Work\Cortex\cortex\supabase\migrations\20261105270000_reception_calendar_scope.sql` returns only `clinic_id = p_clinic`.
  - `E:\Work\Cortex\cortex\supabase\migrations\20261105250000_reception_legacy_cancellation.sql:41-44` checks conflicts against all the doctor's appointments.
  - `E:\Work\Cortex\cortex\src\components\AppointmentModal.tsx:251` inserts without `clinic_id`.
  - `E:\Work\Cortex\cortex\src\features\reception\api.ts:82-83` holds the generic message.
- What goes wrong: a slot looks free, the booking returns "Horário ocupado ou bloqueado. Escolha outro intervalo.", and nothing on screen explains why. Everything the doctor books in her own Agenda is invisible to reception.
- Note: this is a documented limit (`E:\Work\Cortex\cortex\docs\product\clinic-crm\CLINIC_CALENDAR_BOUNDARY.md`, "Disponibilidade e histórico"), but it will hit the pilot daily.
- Fix: show hidden appointments as anonymous "Ocupado (agenda do médico)" intervals, or stamp `clinic_id` on appointments created by single-clinic doctors. As a stopgap, say in the 23P01 text that the doctor may have a private commitment.
- Effort: M (S for the text).

**7. [P2] [CONFIRMED] Booking is blind**
- Where: `E:\Work\Cortex\cortex\src\features\reception\BookingDialog.tsx:39-41`; `ReceptionCalendar.tsx:169-212`; `CaseWorkspace.tsx:116`, `:305`.
- What goes wrong:
  - The dialog shows none of the doctor's appointments or blocks. Opened from a case, no agenda is visible at all.
  - Times default to 09:00–09:30 and the end does not follow the start, so "start 14:00" fails on submit with "O término deve ser depois do início."
  - The agenda is a list of cards, not a time grid. Blocks are always listed above the appointments regardless of time (visible in `shots-reception\largo-recepcao-agenda.png`).
- Fix:
  - Load the chosen doctor's day inside the dialog with `receptionApi.appointments`.
  - Keep the duration when the start changes.
  - Merge blocks into the chronological list.
- Effort: M.

**8. [P2] [CONFIRMED] A first-time caller cannot be scheduled from the Agenda**
- Where: `E:\Work\Cortex\cortex\src\features\reception\ContactSearch.tsx:58-62`; `BookingDialog.tsx:199-205`; `ContactsPage.tsx:22-33`; `E:\Work\Cortex\cortex\supabase\migrations\20261103002000_reception_workflow.sql:145`.
- What goes wrong: "Novo agendamento" finds no contact and says "Cadastre um atendimento na recepção primeiro." The only way to create a contact is inside "Novo atendimento". The full path is:
  1. Atendimentos → Novo atendimento → Novo contato → name, phone, subject → Adicionar à fila.
  2. Assumir atendimento (a new case is created unassigned).
  3. Agendar consulta → "Primeiro cadastro com este médico" → type the name again → time → checkbox → Confirmar.
- Also: creating a contact gives no warning when the phone already exists.
- Fix:
  - Inline "Novo contato" in `ContactSearch`.
  - Prefill the patient name from the contact when the relation is "É o próprio paciente".
  - Auto-assign a case to its creator.
  - Warn on an existing phone.
- Effort: M.

**9. [P2] [CONFIRMED] A conversation shows no phone number, no link to contact or case, no send status and no media**
- Where: `E:\Work\Cortex\cortex\src\features\reception\WhatsAppInbox.tsx:160-164`; `WhatsAppMessages.tsx:57-65`, `:84-88`.
- What goes wrong:
  - Only the WhatsApp profile name is shown (or "Contato sem nome"). The number appears only inside the consent and transfer dialogs.
  - `contactId`, `caseId`, `windowOpenUntil`, message `status`, `error` and `sentBy` are never rendered.
  - A photo or PDF is just the word "Imagem" or "Documento".
  - The owner is shown as "Outra pessoa".
- Fix:
  - Show the number, with "Abrir contato" and "Novo atendimento" buttons.
  - Add a status chip for failed or unknown outbound messages.
  - Add a download button using the `media` action.
  - Show the owner's name.
- Effort: M.

**10. [P2] [CONFIRMED] After "Assumir conversa" under "Sem responsável", the conversation disappears**
- Where: `E:\Work\Cortex\cortex\src\features\reception\WhatsAppInbox.tsx:82`, `:89-103`, `:169-171`.
- What goes wrong: the detail is taken from the filtered list. After the reconciling refetch the item is gone, the pane shows "Selecione uma conversa…", and the message says "Confira o responsável atual na conversa." She must switch to "Minhas conversas" and find it again. "Encerrar" under "Em aberto" behaves the same way.
- Fix: switch to "Minhas conversas" after a claim, or keep the detail mounted from its own read; fix the message when the item left the filter.
- Effort: S.

**11. [P2] [CONFIRMED] Equipe: "Desativar acesso" is one click and irreversible; "Salvar permissões" fails on approved delegations**
- Where: `E:\Work\Cortex\cortex\src\features\reception\TeamSettings.tsx:231-257`; `api.ts:71-77`; `E:\Work\Cortex\cortex\supabase\migrations\20261104250000_reception_legacy_array_guard.sql:16`, `:25-29`.
- What goes wrong:
  - Deactivating has no confirmation. It deletes all the secretary's agenda scopes and returns her open cases to the queue. Restoring access needs a new request and approval from each doctor.
  - Unticking a doctor whose delegation was approved and saving always returns "A lista está desatualizada… Atualize a página". Refreshing does not help; the real path is "Conferir origem" → "Revogar aprovação".
- Fix:
  - Add a confirmation that lists the consequences.
  - Show approved delegations as read-only rows with the existing `WithdrawDelegation` button; keep checkboxes for legacy scopes only.
  - Reword the 40001 text.
- Effort: S–M.

**12. [P2] [CONFIRMED, screenshots] On screens narrower than 1728 px the reception gets the phone layout**
- Where: `E:\Work\Cortex\cortex\tailwind.config.ts:10` (breakpoints ×1.35); `E:\Work\Cortex\cortex\src\index.css:9`; `E:\Work\Cortex\cortex\src\components\WorkspaceShell.tsx:67-68`; `ReceptionCalendar.tsx:207`; `WhatsAppInbox.tsx:148`.
- What goes wrong: no sidebar and a bottom tab bar. Agenda cards are single-column and the inbox stacks list above conversation below 1382 px. At 1280×900 the first screen of the agenda shows the heading, the filters and half of one appointment.
- Evidence: `shots-reception\desktop-recepcao-agenda.png`, `desktop-recepcao-contatos.png`.
- Fix: for the reception workspace use unscaled layout breakpoints (sidebar from 1280 px), one-line appointment rows with actions in a menu, and a collapsible filter card.
- Effort: M.

**13. [P3] [CONFIRMED] Indicadores rejects an end time in the future and fails at random when the PC clock runs ahead**
- Where: `E:\Work\Cortex\cortex\src\features\reception\ReceptionDashboard.tsx:16-26`; `whatsappDashboard.ts:44`; `E:\Work\Cortex\cortex\supabase\functions\_shared\whatsappHandlers.ts:900`.
- What goes wrong: the default end is the client clock floored to the minute, and the server rejects `to > now`. "Hoje 00:00–23:59" fails with "Confira o período e a página do painel…", which does not say why.
- Fix: clamp `to` to now minus 60 s (or clamp on the server) and state the rule in the help text.
- Effort: S.

**14. [P3] [CONFIRMED] Searches blank on every keystroke and are accent-sensitive**
- Where: `E:\Work\Cortex\cortex\src\features\reception\ContactDirectory.tsx:39-48`, `:70`; `ContactSearch.tsx:24-32`; `BookingDialog.tsx:76-81`; `E:\Work\Cortex\cortex\supabase\migrations\20261103002000_reception_workflow.sql:93`, `:107`.
- What goes wrong: there is no debounce and results render only when fresh, so the list disappears while typing. "Jose" does not find "José". The contact search is not trimmed.
- Fix: 300 ms debounce, keep the previous results while loading, `unaccent` and trim on the server.
- Effort: S.

**15. [P3] [CONFIRMED] Agenda card feedback**
- Where: `E:\Work\Cortex\cortex\src\features\reception\ReceptionCalendar.tsx:157`; `ReceptionAppointmentCard.tsx:23-24`.
- What goes wrong:
  - Errors from Confirmar, Chegada or Cancelar appear at the top of the page, off screen in week view.
  - "Confirmar presença" stays on appointments that are already confirmed.
  - "Registrar chegada" is offered on future days.
- Fix: toast per action; hide or relabel by state.
- Effort: S.

**16. [P3] [CONFIRMED] Queue and case wording**
- Where: `E:\Work\Cortex\cortex\src\features\reception\CaseWorkspace.tsx:119-126`, `:206-213`; `ContactDirectory.tsx:76-77`; `ReceptionQueue.tsx:141-148`.
- What goes wrong:
  - "Cancelar demanda" and "Concluir atendimento" act on one click, and reopening unassigns the case.
  - "Abrir atendimento" on a contact creates a new case, with no view of that contact's existing cases or appointments.
  - The queue is newest-first and shows no age or phone.
- Fix: confirm cancel; rename to "Novo atendimento para este contato"; show waiting time and offer oldest-first.
- Effort: S.

**17. [P3] [CONFIRMED] "Mudar fila" is a free-text slug and queues cannot be filtered**
- Where: `E:\Work\Cortex\cortex\src\features\reception\WhatsAppQueueAction.tsx:10-23`; `WhatsAppInbox.tsx:138-140`.
- What goes wrong: a typo silently creates a new queue, and the bot's routing to queues cannot be used for triage.
- Fix: a select of known queues, plus a queue filter (needs a server list).
- Effort: M.

**18. [P3] [CONFIRMED] Empty states for a new clinic**
- Where: `E:\Work\Cortex\cortex\src\features\reception\WhatsAppInbox.tsx:45-49`; `ClinicAccessGate.tsx:89`.
- What goes wrong:
  - An admin without WhatsApp connected is told "Peça à administração…", with no link to Configurações and no distinction between never connected, disconnected and error.
  - A receptionist with zero delegated agendas is locked out of everything, including the inbox, which the contract says is not per-doctor.
- Fix: role-aware text with a link; let the inbox and contacts open without a delegated agenda if that is the intent.
- Effort: S.

**19. [P3] [CONFIRMED] Only the admin can correct a contact**
- Where: `E:\Work\Cortex\cortex\src\features\reception\ContactDirectory.tsx:27` (`canEdit={access.admin}`).
- What goes wrong: a receptionist who mistypes a name or phone cannot fix it and sees no hint about whom to ask.
- Fix: add a hint, or allow the creator to correct it for a short time.
- Effort: S.

## Checked and OK
- **Dates:** São Paulo wall time to UTC conversion, day boundaries, half-open ranges and block overlap in `dates.ts`, `appointmentTiming.ts` and `ReceptionCalendar.tsx` (read only).
- **RPC consistency:** argument names, action names and value keys match the SQL for queue, case, notes, drafts, booking, change, block and unblock. Error codes 40001, 23P01, 42501 and 22023 are mapped.
- **WhatsApp adapters:** the `act` wire shape and error codes match the handler.
- **Double submit:** request IDs are reused on retry, synchronous `pending` refs are in place, and case/agenda mutations stay pending until the refetch completes.
- **Draft hook:** `useCaseDraft` handles revision races correctly (read; the existing test passes).
- **Existing tests run:** `ReceptionQueue.test.tsx` and `useCaseDraft.test.tsx`, 3 passed.
- **Browser audit:** reception role on `/recepcao/agenda`, `/contatos`, `/painel`, `/equipe` at 1920, 1280 and 375 px: no horizontal overflow, console errors or unlabelled controls. Content scrolls above the bottom bar.

## Not covered
- The queue screen and the WhatsApp inbox in a real browser; the audit run produced no `/recepcao` screenshot and its inbox fixture is empty.
- Keyboard and focus behaviour in a real browser.
- Admin and doctor runs of the browser audit, and `reception-app-audit-browser.mjs`.
- `src/pages/Sharing.tsx`, `LinkRelationshipDialog`, `LinkStateDialog`, and the embedded Pré-consultas and Financeiro pages.
- `DelegationPermissions`, `WithdrawDelegation` and `StaffAccessProvenance` were read but not exercised.
- `tsc` was not run. Findings 1, 2 and 6–19 are from code reading and screenshots, not runtime tests.
- No hosted checks. I did not answer the open coordination messages addressed to `claude`, because of the read-only rule.
