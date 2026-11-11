# Relatório do revisor: Consultório do médico (funções)

Revisor independente, sem o contexto da conversa principal, só para leitura. Texto original do revisor (em inglês), de 11/11/2026. Os caminhos em `E:\Work\cortex-audit-tmp\` são arquivos de trabalho fora do repositório.

---

**Summary**

- I read the doctor's workspace end to end (Index → ChatPanel → useRecording → drafts and rescue → review → finalize, plus patient, documents, agenda, templates, knowledge, assistant and shell) and wrote 5 focused repro files; all 9 tests pass, which reproduces the findings marked "test".
- The 2026-11-10 refactor did not break the main flows; most defects are older. The one data-loss issue is in the path that recovers interrupted recordings.
- The next tier: a consultation can start under an invisible, previously selected patient; the manual-consultation editor disables its textarea on every autosave; several places silently drop typed input or note lines; allergies and diagnoses cannot be corrected.
- Not run: the existing suite, typecheck, or a real browser. Focus, popup, MediaRecorder and mobile behaviours are SUSPECTED where noted.

Repro tests are in `E:\Work\cortex-audit-tmp\review\clinical\tests\` (config: `E:\Work\cortex-audit-tmp\review\clinical\vitest.config.mts`). Paths below are relative to `E:\Work\Cortex\cortex\`.

## Findings

**1. [P1] [CONFIRMED] A rescued recording is erased from the browser before it is safe on the server, and can collide with an existing draft**
- Where: `src/components/ChatPanel.tsx:299-304`, `:1605-1620`, `:1017-1055`; `supabase/migrations/20261028000100_clinical_durability.sql:14`.
- Scenario: a recording is interrupted (session ended) and parked in IndexedDB. Later the doctor clicks "Processar gravação". The entry is deleted first, then the draft is saved and the audio uploaded.
  - If that first call fails, the only copy is in tab memory; a reload or close loses the consultation.
  - The button is disabled only by `isProcessing`. If the patient already has a draft, the new draft id violates `unique(user_id, patient_id)`. The visible recovery notice is replaced by a phantom draft, and "Reenviar áudio" fails every time.
- Evidence: `rescued-recording.test.tsx` (2 tests) — delete runs first, upload is never called, "guardado apenas nesta aba" is shown, and the button is enabled with a pending draft.
- Fix: delete the IndexedDB entry only after upload succeeds; disable "Processar gravação" while `reviewData || recoveryDraft || isRecording || draftLoading`; on a save failure re-park the blob.
- Effort: S.

**2. [P2] [CONFIRMED in code; mobile effects SUSPECTED] Recording audio lives only in memory until stop**
- Where: `src/hooks/useRecording.ts:346-348`, `:383`; no `wakeLock`, `visibilitychange` or `pagehide` handling anywhere in `src`.
- Scenario: a 30-minute consultation on a tablet or phone. Screen auto-lock, app switch, tab discard or a crash loses everything; only a clean unmount reaches the rescue path. In teleconsultation mode a mic track ending is silent (only the shared video track is watched, `:326-333`).
- Fix: append the 500 ms chunks to the existing IndexedDB rescue store during capture and clear on successful upload; request a screen wake lock while recording; warn on mic `ended`/`mute`.
- Effort: M.

**3. [P2] [CONFIRMED] "Nova Consulta" can start for a patient who is no longer on screen**
- Where: `src/components/NewConsultationModal.tsx:39-41`, `:145-149`, `:173`, `:87`, `:100`.
- Scenario: search "Maria", click Maria Silva, change the search to "Ana". Only Ana Paula is listed and nothing is highlighted. Type the complaint and press "Iniciar Consulta": the consultation starts for Maria.
- Evidence: `new-consultation.test.tsx` — `onStartConsultation('maria-id', …)` with one visible, unselected option.
- Fix: clear `selectedPatientId` when the search changes, or show a persistent "Paciente selecionado: X" chip.
- Effort: S.

**4. [P2] [CONFIRMED parser; trigger SUSPECTED] The SOAP section parser drops lines on screen and in print**
- Where: `src/components/SoapNoteView.tsx:12-19`; `src/lib/printDoc.ts:90-114`.
- Scenario: the regex does not match the prompt's own format `**S (Subjetivo):**`, so those notes fall back to plain markdown, and "Exportar PDF" prints literal `**`. If the model or a manual edit writes `**S (Subjetivo)**:`, the sectioned view activates and omits everything outside S/O/A/P. In the test, a leading line, "**Alergias:** dipirona", "**Atenção:** suspender se…" and "**Retorno:** 30 dias" all disappeared. Print activates with a single match.
- Evidence: `soap-view.test.tsx` (3 tests).
- Fix: accept the colon inside or outside the bold, keep preamble and trailing text as their own blocks, and never render sections unless all input text is accounted for; share one parser between screen and print.
- Effort: S.

**5. [P2] [CONFIRMED; Chrome focus loss SUSPECTED] The manual-consultation editor disables the textarea during every autosave**
- Where: `src/components/ClinicalWorkEditor.tsx:113-114`, `:156-164`, `:321-328`.
- Scenario: the doctor pauses 1.2 s, autosave starts, `busy` disables the textarea for the whole request. Keystrokes in that window are dropped; Chrome likely also drops focus.
- Evidence: `work-editor.test.tsx` — the focused textarea is disabled while the insert is pending.
- Fix: do not disable inputs for autosave; keep the `saving` ref and show "Salvando…" only.
- Effort: S.

**6. [P2] [CONFIRMED] The profile-update card silently drops text typed in an "add" field**
- Where: `src/components/ProfileUpdateCard.tsx:91-100`, `:160-166`, `:201-226`, `:258-264`.
- Scenario: Editar → type "Penicilina" in "Adicionar alergia…" → "Salvar edição" without pressing +. The allergy is not saved, yet the card says "Perfil clínico atualizado". Same for diagnoses and medications.
- Evidence: `profile-card.test.tsx` — `onAccept` receives `allergies: []`, then the success text.
- Fix: flush non-empty add buffers in `handleAccept`, or block save while one is non-empty.
- Effort: S.

**7. [P2] [CONFIRMED in code] A second pending comment proposal can never be applied, and pending proposals vanish unguarded**
- Where: `src/components/CommentProposalCard.tsx:24`, `:63-70`; `supabase/functions/process-comment/index.ts:309-314`; `src/components/ChatPanel.tsx:494-516`, `:333-351`.
- Scenario: two comments typed in a row give two cards with the same `expectedRevision`. Applying the first bumps the revision; the second always gets 409 "alterado em outra janela". Any other chart change does the same. The doctor must discard and retype.
- Also: an unapplied card is not counted as work and exists only in memory, so navigating away loses the comment without a prompt.
- Fix: on 409, re-run extract (or refetch the revision) inside the card; count pending cards in `busy`.
- Effort: M.

**8. [P2] [CONFIRMED in code] Allergies and diagnoses cannot be removed, or added without AI**
- Where: write paths are only `src/components/ChatPanel.tsx:1449-1455` (additive merge) and the comment-apply path; the edit form at `src/pages/PatientManagement.tsx:291-362` has no clinical fields; `src/components/PatientSnapshot.tsx:190-267` is read-only.
- Scenario: a wrong allergy or diagnosis is accepted and stays forever; with AI off or quota exhausted, an allergy cannot be recorded structurally at all.
- Fix: add/remove controls in the snapshot or profile drawer with the existing revision check.
- Effort: M.

**9. [P2] [CONFIRMED in code] The document composer has no free-text medication, and its error text says to fill one in manually**
- Where: `src/components/DocumentComposerModal.tsx:222-299`, `:577-602`, `:653-657`, `:841`.
- Scenario: a product missing from the Anvisa table, or a failed search, means the drug cannot be prescribed. The error says "preencha o medicamento manualmente" but no such control exists. A search with zero hits shows nothing.
- Related risk: every profile medication is pre-checked on open (`:154-165`), so a new prescription includes all of them unless unchecked.
- Fix: add "Adicionar medicamento manualmente"; show "Nenhum medicamento encontrado"; consider not pre-checking profile medications.
- Effort: S–M.

**10. [P2] [SUSPECTED] The generated prescription opens with `window.open` after an await**
- Where: `src/components/ChatPanel.tsx:886`.
- Scenario: once the click's activation has lapsed (slow generation, Safari), the popup is blocked. The toast says "Receita gerada… Imprima, assine e carimbe" but offers no link; the doctor must find Perfil → Documentos.
- Fix: open a blank window synchronously and set its location afterwards, or add an "Abrir PDF" action.
- Effort: S.

**11. [P2] [CONFIRMED in code] Expired prescriptions cannot be opened, and the list never shows what was prescribed**
- Where: `src/components/PrescriptionList.tsx:35-36`, `:150-161`, `:174-182`.
- Scenario: "what did I prescribe two months ago?" The row shows only type, date and code, and "Abrir documento" is disabled once `expires_at` has passed.
- Fix: let the owner view expired documents (watermarked), or show the medication list from the issuance snapshot.
- Effort: M.

**12. [P2] [CONFIRMED in code] On desktop, "Início" hides the open consultation with no way back**
- Where: `src/pages/Index.tsx:386-395`, `:406-410`, `:441-460`; `src/components/PatientSidebar.tsx:96-103`.
- Scenario: mid-consultation with a walk-in patient (not in today's agenda or the top 5 recents), the doctor clicks "Início". The chat and profile disappear. While recording, the top banner offers only pause/stop, route changes are blocked, and "Nova Consulta" is refused. Mobile has a "Consulta" tab; desktop has no equivalent.
- Fix: show a "Voltar à consulta de {nome}" entry on the dashboard and sidebar while a patient is selected, and make the capture banner's patient name a link.
- Effort: S.

**13. [P2] [CONFIRMED in code] The Templates page cannot activate a template or show which one is active**
- Where: `src/pages/Templates.tsx:351-355`; the only selector is `src/features/settings/ProfessionalSettingsForm.tsx:27`.
- Scenario: the doctor creates a template and expects it to apply. The page says "O modelo escolhido ao iniciar uma gravação…", but no choice exists at recording start.
- Fix: add a "Usar nas evoluções" action and an "Em uso" badge; correct the copy.
- Effort: S.

**14. [P2] [SUSPECTED, depends on volume] The appointment modal's patient picker is a non-searchable Select of every patient**
- Where: `src/components/AppointmentModal.tsx:414-432`; `src/pages/Calendar.tsx:160-170`.
- Scenario: with a few thousand patients the dropdown renders thousands of items with no filter, after downloading all columns for all rows.
- Fix: reuse the server-side name search from `NewConsultationModal`; select only `id, name, age, phone, email`.
- Effort: M.

**15. [P3] [CONFIRMED in code] Patient-edit conflict has no way out without a page reload**
- Where: `src/pages/PatientManagement.tsx:136-150`.
- Scenario: after "Paciente alterado em outra sessão", reopening uses the same stale row and fails again.
- Fix: invalidate `['patients', user.id]` on conflict and re-seed the form.
- Effort: S.

**16. [P3] [CONFIRMED in code] Hidden "Extrair com IA" drafts keep triggering unsaved-work prompts**
- Where: `src/components/PatientSnapshot.tsx:57-68`.
- Scenario: text typed for patient A keeps `hasWork` true after switching, so every later switch or navigation asks about work the doctor cannot see.
- Fix: count only the current patient's draft, or name the patient in the prompt.
- Effort: S.

**17. [P3] [CONFIRMED] An untouched "Consulta manual" opened with a chief complaint counts as unsaved**
- Where: `src/components/ClinicalWorkEditor.tsx:45`, `:64-67`.
- Evidence: `work-editor.test.tsx` — "Alterações ainda não salvas" on open, and the exit guard prompts.
- Fix: initialise `lastSaved` to the initial snapshot.
- Effort: S.

**18. [P3] [CONFIRMED in code] Missing or wrong query invalidations**
- Where: `src/components/ClinicalProposals.tsx:205-210`; `src/pages/ClinicalWorkspace.tsx:257-261`.
- Detail:
  - Approving a proposal invalidates `['consultations', patientId]`, a key nothing uses, and not `patient-detail`, `patient-clinical-notes` or `patient-consultations`; the snapshot's notes stay stale.
  - Confirming a manual consultation does not invalidate `appointments-today`, `appointments` or `patient-consultations`; the sidebar still shows the appointment as Agendado.
- Effort: S.

**19. [P3] [CONFIRMED in code] Chat review cards forget their state when the doctor switches patients**
- Where: `src/components/ProfileUpdateCard.tsx:59`; `src/components/CommentProposalCard.tsx:40`; `src/components/ChatPanel.tsx:1848-1859`.
- Scenario: accepted or dismissed cards reappear as pending on return; re-applying a comment card then hits the 409 of finding 7.
- Fix: keep the status on the message object.
- Effort: S.

**20. [P3] [CONFIRMED in code] Editing a saved SOAP in the chat has no cancel**
- Where: `src/components/ChatPanel.tsx:1282-1330`, `:1888-1906`.
- Scenario: the only exit is the check (save). A double click sends two updates, and the second shows "Erro ao salvar alterações" after a success.
- Fix: add Cancel and a saving guard.
- Effort: S.

**21. [P3] [CONFIRMED in code] "Recuperar consulta" downloads audio it does not use**
- Where: `src/components/ChatPanel.tsx:1140-1151` versus `:1038-1043`.
- Scenario: on a weak connection the download blocks a retry that needs only the storage path. If the upload never completed, the message blames the connection.
- Fix: skip the download when the path exists; show a specific message when the object is missing.
- Effort: S.

**22. [P3] [CONFIRMED in code] The calendar is replaced by a spinner on every day/week/month change**
- Where: `src/pages/Calendar.tsx:411-443`.
- Fix: `placeholderData: keepPreviousData`.
- Effort: S.

**23. [P3] [CONFIRMED in code] Home shows zeros and an open "Primeiros passos" while patients load or fail, plus a permanently empty disclosure**
- Where: `src/components/WelcomeDashboard.tsx:134-141`, `:225-228`; `src/components/OnboardingCard.tsx:37`.
- Fix: add loading and error states for the counters; render the `<details>` only when the card renders.
- Effort: S.

**24. [P3] [CONFIRMED in code; iOS print SUSPECTED] AI patient summary and referral cannot be edited and are lost on close**
- Where: `src/components/DocumentPreviewModal.tsx:112-115`, `:139-141`.
- Scenario: no editing before print, no confirm on close (regeneration costs credits). `print()` followed immediately by `close()` may close before printing on iOS.
- Effort: S–M.

**25. [P3] [CONFIRMED in code] Patient status stays "Em atendimento" if the consultation is never finalized**
- Where: `src/pages/Index.tsx:312`, `:341`; only encounter completion changes it back.
- Effort: S.

**26. [P3] [CONFIRMED in code] `ImportPatientsModal` is unreachable and has a stuck state**
- Where: `src/components/ImportPatientsModal.tsx:133-138`, `:171-178`; nothing imports it (the "Migração" button opens an info dialog).
- Detail: if the existing-patients read throws, `importing` stays true and the dialog cannot be closed.
- Fix: delete the component, or move the read inside the try/finally before re-enabling.
- Effort: S.

**27. [P3] [CONFIRMED in code; visual impact not checked in a browser] Mobile and accessibility polish**
- "Sair" sits in the consultation bottom tab bar and signs out with no confirmation when nothing is dirty (`src/pages/Index.tsx:524-531`).
- Icon targets are 20–28 px: `src/components/PrescriptionList.tsx:166-191`, `src/components/ProfileUpdateCard.tsx:410-417`, `src/components/QuestionChecklistCard.tsx:39-57`.
- 9–10 px text and `text-medical-blue/50-60` on light backgrounds.
- `src/components/RecordingModeDialog.tsx:41` uses a `<p>` instead of `DialogDescription`.
- Effort: S.

**28. [P3] [CONFIRMED in code] The pilot clinic's name is hard-coded**
- Where: `src/lib/printDoc.ts:123`, `:149`, `:256` ("Haddad Nicola · Cortex" on every printed evolution, medication list and dossier); `src/components/PatientSidebar.tsx:96`; `src/components/WorkspaceShell.tsx:70`.
- Fix: use `access.clinic.name`.
- Effort: S.

**29. [P3] [SUSPECTED] The workspace is concealed on every token refresh**
- Where: `src/components/SessionAssurance.tsx:108`, `:124`, `:157-163`.
- Scenario: the query key includes `session.expires_at`, so roughly hourly the screen shows "Verificando sessão…" and focus leaves the field being typed in. An existing test confirms the concealment is intended; duration and keystroke loss are unverified.
- Fix: keep the previous result as placeholder for the same user.
- Effort: S.

**30. [P3] [CONFIRMED in code] Smaller items**
- `src/components/WorkspaceShell.tsx:65`: a failed sign-out is an unhandled rejection with no message.
- `src/pages/Assistant.tsx:93-102`, `:168-175`: the first send swaps input elements and focus is lost.
- `src/pages/ClinicalWorkspace.tsx:262-272`: "Marcar concluído" has no busy guard; a double click alerts a false failure.
- `src/components/DocumentComposerModal.tsx:414`: the description still says the signature "será acoplada" when signing is configured.
- Effort: S.

## Checked and OK

- **Patient switching:** async writers are guarded (`isCurrentPatient`, briefing request counters); the appointment id is cleared on URL and "Nova Consulta" switches.
- **Recording lifecycle:** each recorder owns its chunks, streams and callbacks; unmount releases devices and parks audio; a recording blocks navigation, patient switch and sign-out.
- **Review modal:** close, Escape and overlay all save edits and comments to the draft; regenerate is preview-only; a failed confirm keeps the text.
- **Finalize:** invalidates patients, consultations, appointments and usage.
- **Manual-encounter finalize:** the server already tolerates a completed or cancelled appointment (`supabase/migrations/20261101000000_review_hardening.sql`).
- **Error and empty states:** distinguished from read failures in the today agenda, recovery notices, the profile drawer, `PrescriptionList`, `PatientFiles`, Templates, KnowledgeBase and Calendar.
- **Optimistic concurrency:** present on anamnesis and history edits, appointments, work items and the profile-accept path.
- **Callbacks:** `SignatureReturn` and `GoogleOAuthCallback` make one exchange per code, validate the return path, and have error states.
- **Navigation:** every route is reachable from a menu; `/trabalho` redirects correctly.

## Not covered

- **Real browser:** nothing was run in one — no 375 px visual pass, keyboard walk-through, contrast measurement, popup or focus behaviour, actual MediaRecorder or `getDisplayMedia`.
- **Existing suite and typecheck:** not re-run; only the 5 scratch files were.
- **Read only superficially or not at all:** `ReferenceSearch`, `PrescriptionTemplatePicker` beyond its first 60 lines, `CalendarWeekDetails`, `UsageMeter`, `LiveCopilotCard` (feature is forced off in `useUserSettings`), `PatientAdministrativeFields` and `patientRegistration` rules, `signatureClient`/`useSignatureSession` internals, `ProtocolSharing`, `SpecialtySettingsSheet`, `useSeedPatients`, `knowledge.ts`, `knowledgeFile.ts`.
- **Server behaviour:** inferred only from the SQL and function source cited above; nothing was executed against a database.
- **Coordination:** I read `coordination/README.md` but, being read-only, wrote no replies in `coordination/mensagens/`.
