# Relatório do revisor: UX do médico e páginas públicas

Revisor independente, sem o contexto da conversa principal, só para leitura. Texto original do revisor (em inglês), de 11/11/2026. Os caminhos em `E:\Work\cortex-audit-tmp\` são arquivos de trabalho fora do repositório.

---

# UX review — doctor's environment and public pages

## Verdict

- **Works well:** the brand feel is calm and coherent, copy is mostly honest and "você"-voiced, subpages share a recognisable header, and error and empty states exist almost everywhere with a retry. No text is under 12 px and no page scrolls sideways.
- **Unfinished:** the layout only becomes a desktop app at 1728 px. On a 1366×768 laptop, and on a 1080p laptop at Windows 125% scaling (1536×864), the doctor gets the phone layout: bottom tab bar, no sidebar, no patient column.
- **Unfinished:** home and subpages use two different navigation systems, and dialogs and forms follow four different patterns.
- **Unfinished:** on a phone the 135% scale leaves almost no room for content; the consultation screen has about 135 px for the conversation.
- **Three changes with most impact:** (1) decouple layout breakpoints from the 135% type scale so laptops get sidebar + patient column; (2) keep allergies and medications visible during the consultation and compact the phone layout; (3) one navigation and one dialog/form pattern, starting with login and agenda, where the primary content sits below the fold.

All screenshots are under `E:\Work\cortex-audit-tmp\review\ux-doctor\` (abbreviated `…\` below). Viewports: lap = 1366×768, hd = 1536×864, wide/largo = 1920×1080, phone = 375×812 at 2×. Source paths are relative to `E:\Work\Cortex\cortex\`.

## Findings

**[P1] 1. Laptops get the phone layout** — all doctor routes, 1366×768 and 1536×864.
- The sidebar and three-column consultation appear only at ≥1728 px because Tailwind screens are multiplied by 1.35. At 1536 px the consultation is one stretched column with a bottom tab bar and a large empty middle.
- Screenshots: `…\pass1\lap-home.png`, `…\pass5\hd-chart.png`; compare `…\pass1\wide-chart.png`.
- Files: `tailwind.config.ts` (screens), `src/lib/interfaceScale.ts`, `src/index.css` (`:root{font-size:135%}`, `@media not all and (min-width:1728px)`), `src/pages/Index.tsx`, `src/components/WorkspaceShell.tsx`.
- Change: keep the enlarged type but put layout breakpoints back on real pixels (xl = 1280). Between 1280 and 1727 show a narrow icon-plus-label sidebar and the patient column at about 18rem; keep the bottom bar only under 1024.
- Effort L.

**[P1] 2. Allergies, medications and diagnoses are hidden during the consultation on laptop and phone** — `/?patient=…`, lap, hd, phone.
- The consultation view shows only name and status. Tapping "Perfil" switches to the patient panel but immediately opens the full profile drawer on top of it, and the drawer's "Geral" tab has no allergies. The red "Alergia a Dipirona" is visible only after closing the drawer.
- Screenshots: `…\pass1\lap-chart.png`, `…\pass2\lap-snapshot-tab.png`, `…\pass2\phone-profile-geral.png`.
- Files: `src/pages/Index.tsx` (~l.508, `setProfileRequest` on the Perfil tab), `src/components/ChatPanel.tsx` (header l.1557–1590), `src/components/PatientProfileDrawer.tsx`.
- Change: under the patient name always show a chip row: red "Alergia: Dipirona", "1 medicação em uso", "N95.1". The Perfil tab should show the panel only; the drawer opens from "Perfil completo".
- Effort M.

**[P1] 3. Phone consultation screen has about 135 px for content** — `/?patient=…`, phone.
- Header with three wrapped buttons takes 245 px, the composer about 330 px, the tab bar 86 px. "Acompanhamento" touches its button edges.
- Screenshot: `…\pass1\phone-chart.png`.
- File: `src/components/ChatPanel.tsx` (l.1578–1588, 2194–2328).
- Change: below `sm`, one "Ações" menu instead of three buttons; mode toggle, field and mic on one row; remove the usage chip and the hint line.
- Effort M.

**[P1] 4. Login: the real "Entrar" button is below the fold** — `/auth`, lap and phone.
- A one-item tab list labelled "Entrar" sits above the fields and looks like the button; the real one is at y≈940 on a 768 px screen. The error message renders above that tab, far from the button.
- Screenshots: `…\pass1\lap-auth.png`, `…\pass1\phone-auth.png`, `…\pass3\lap-auth-wrong-password-full.png`.
- File: `src/pages/Auth.tsx` (l.173–178, 179–186, 222–225).
- Change: delete the Tabs; drop the "Ambiente clínico" eyebrow; use the compact logo below `lg`; put the error directly above the submit button. Logo, title, two fields and button should fit in 640 px.
- Effort S.

**[P1] 5. Agenda shows no appointments on the first screen** — `/agenda`, lap and phone.
- About 540 px of header, description, "Conectar Google", a card with "Lista de espera e confirmações" plus explanation, view switch, legend and a second toolbar. On phone the whole first screen is chrome.
- Screenshots: `…\pass1\lap-agenda.png`, `…\pass1\phone-agenda.png`.
- File: `src/pages/Calendar.tsx`.
- Change: one toolbar row: `Hoje ‹ ›` · "8–14 de novembro" · `Dia|Semana|Mês|Lista de espera` · "+ Novo agendamento". Move "Conectar Google" to Configurações › Agenda e assinatura, remove the description, put the legend under the grid.
- Effort M.

**[P1] 6. "Tipo de consulta" (recording) dialog does not fit a phone** — phone.
- Measured: top −98 px, bottom 910 px in an 812 px viewport, no scroll. Title and close are off-screen and the cards are clipped on the right.
- The consent box is a 13×13 px native checkbox, and both options look disabled with no explanation.
- Screenshots: `…\pass2\phone-chart-record-dialog.png`, `…\pass2\lap-chart-record-dialog.png`.
- File: `src/components/RecordingModeDialog.tsx` (l.38, 47–52).
- Change: `max-h-[90dvh] overflow-y-auto`; use the shared Checkbox in a 44 px row; add "Marque o consentimento para escolher o tipo"; show the teleconsultation tip only inside that card.
- Effort S.

**[P2] 7. Two navigation systems** — home vs every other page.
- The bottom bar is Início/Agenda/Pacientes/Menu on home, Início/Menu/Consulta/Perfil/Sair in the menu and consultation, and Início/Agenda/Pacientes/Mais on subpages.
- At 1920 the home sidebar has no Financeiro, Segurança or Sair; the subpage sidebar does. Logo block widths differ (300 vs 324 px).
- Screenshots: `…\pass1\lap-home.png`, `…\pass2\lap-home-menu.png`, `…\pass1\lap-patients.png`, `…\audit-doctor\largo-inicio.png`, `…\audit-doctor2\largo-pacientes.png`.
- Files: `src/pages/Index.tsx` (l.497–533), `src/components/PatientSidebar.tsx`, `src/components/WorkspaceShell.tsx`, `src/components/MobileSubpageNavigation.tsx`.
- Change: one bar everywhere (Início · Agenda · Pacientes · Mais); Consulta/Perfil become a two-segment switch in the consultation header; home uses the WorkspaceShell sidebar.
- Effort L.

**[P2] 8. "Sair" is one unconfirmed tap, next to "Perfil"** — consultation, home header, patient panel.
- It is a tab in the consultation bar, an unlabelled icon beside the settings icon on home, and a 38 px icon in the patient panel corner. It confirms only when there is unsaved work.
- Screenshots: `…\pass1\phone-chart.png`, `…\pass1\lap-chart.png`, `…\audit-doctor2\largo-prontuario.png`.
- Files: `src/pages/Index.tsx` (l.128–131, 478–491, 524–531), `src/components/WelcomeDashboard.tsx` (l.205).
- Change: remove it from the bar and patient panel; keep it in the sidebar footer and "Mais"; always ask "Sair da conta?".
- Effort S.

**[P2] 9. Form dialogs hide the required field and primary button below their own fold** — lap and phone.
- "Nova Consulta" (new patient) has 1031 px of content in 689 px; "Queixa Principal *" and "Iniciar Consulta" are not visible. Novo paciente is 1147 px, agendamento 960 px.
- Widths are 1210, 690 and 520 px for the three. Only the document composer has a fixed footer.
- Screenshots: `…\pass2\lap-newconsult-new.png`, `…\audit-doctor\largo-inicio-consulta-novo.png`, `…\pass2\lap-agenda-new.png`, `…\pass2\phone-newconsult-existing.png`.
- Files: `src/components/NewConsultationModal.tsx` (l.111), `src/components/AppointmentModal.tsx` (l.396), `src/pages/PatientManagement.tsx` (l.284).
- Change: one shared dialog (title, scrolling body, fixed footer "Cancelar | primary", max-w 40rem). In Nova Consulta show Nome and Queixa principal first, the rest under "Mais dados (opcional)".
- Effort M.

**[P2] 10. Validation by toast, and disabled buttons with no reason** — forms.
- Novo paciente: the toast "Informe um nome válido…" covers the "Adicionar" button while the name field is scrolled out of view.
- "Agendar" and "Iniciar Consulta" are pale-disabled without saying what is missing; pale gold with white text reads as a soft primary, not as disabled.
- Screenshots: `…\pass2\lap-patients-new-invalid.png`, `…\pass2\lap-agenda-new-invalid.png`.
- Files: `src/pages/PatientManagement.tsx`, `src/components/AppointmentModal.tsx` (l.176), `src/components/NewConsultationModal.tsx`.
- Change: keep buttons enabled; on click show the message under the field, focus it and scroll to it.
- Effort M.

**[P2] 11. Error toasts cover the controls and show raw server text** — consultation and composer.
- The red toast sits bottom-right over "Gerar documento", the mic and the tab bar; on phone it sits at the top over dialog content. The description is the function's message verbatim.
- Screenshots: `…\pass2\lap-composer-generate-error.png`, `…\pass2\lap-chart-comment-result.png`.
- Files: `src/components/ui/toast.tsx` (l.17), toast calls in `src/components/ChatPanel.tsx`, `src/lib/functionErrors.ts`.
- Change: inside dialogs use an inline alert above the footer; elsewhere top-centre; fixed sentences such as "Não foi possível gerar o documento. Nada foi perdido — tente de novo."
- Effort M.

**[P2] 12. A failed AI question stays as a sent bubble with no answer** — consultation.
- Screenshot: `…\pass2\lap-chart-question-error.png`.
- File: `src/components/ChatPanel.tsx`.
- Change: mark the bubble "Não enviada · Tentar novamente".
- Effort S.

**[P2] 13. The same words mean different things** — home, agenda, consultation.
- "Nova Consulta" starts a visit now on home, and is also the title of the scheduling dialog opened by "Novo Agendamento".
- "Consulta manual" and "Acompanhamento" open the same dialog, titled "Acompanhamento do paciente", with an inner serif heading "Documentar e acompanhar" and a second "Fechar".
- Screenshots: `…\pass2\lap-agenda-new.png`, `…\pass2\lap-chart-manual.png`, `…\pass2\lap-chart-followup.png`.
- Files: `src/components/AppointmentModal.tsx` (l.398, 677), `src/components/NewConsultationModal.tsx` (l.113), `src/components/ChatPanel.tsx` (l.1579–1587), `src/components/PatientWorkspaceDialog.tsx`, `src/components/ClinicalWorkEditor.tsx`.
- Change: home "Iniciar atendimento"; agenda "Novo agendamento" / "Editar agendamento"; consultation buttons "Escrever evolução" and "Pendências e retornos" with matching titles; remove the inner heading and second close.
- Effort S.

**[P2] 14. Patient list shows three patients per 1080p screen** — `/gerenciar-pacientes`, desktop.
- Rows are 147 px because edit and archive icons are stacked. "Profissão" is empty, search is "Nome ou profissão…" with no icon, and "Migração" sits beside the primary button.
- Screenshots: `…\audit-doctor2\largo-pacientes.png`, `…\pass4\laptall-patients.png`.
- File: `src/pages/PatientManagement.tsx`.
- Change: 60 px rows with actions in one line or a "⋯" menu; columns Nome · Idade · Telefone · Última consulta · Status; search by name, CPF or phone with an icon; move "Migração" into "⋯".
- Effort M.

**[P2] 15. Internal AI quota shown as patient data** — profile drawer and composer.
- "LIMITE DIÁRIO 0/1500 0%" sits under the patient's stats; "0/1500 · 0%" sits in the input.
- Screenshots: `…\pass2\lap-snapshot-tab.png`, `…\pass1\lap-chart.png`.
- Files: `src/components/UsageMeter.tsx`, `src/components/ChatPanel.tsx` (l.2234), `src/components/PatientProfileDrawer.tsx`.
- Change: remove from the profile; show in the composer only at ≥80% as "Uso de IA hoje: 80%".
- Effort S.

**[P2] 16. Every checkbox is a circle** — whole app, most visible in the patient form.
- `rounded-sm` resolves to about 12 px on a 21.6 px box, so "Tem alguma destas condições?" and the consents look like single-choice radios.
- Screenshots: `…\pass3\lap-intake-partial-errors-full.png`, `…\pass3\phone-intake-filled-full.png`.
- File: `src/components/ui/checkbox.tsx` (l.14).
- Change: `rounded-[4px]`, `h-5 w-5`.
- Effort S.

**[P2] 17. Pre-consultation: errors do not clear, and wording is robotic** — `/pre-consulta/<token>`, phone.
- After the CPF is corrected, "CPF inválido." and "resposta obrigatória." stay red until the next submit.
- The summary reads "CPF: CPF inválido." and "A consulta é particular ou pelo convênio?: resposta obrigatória.".
- Labels are fixed at 15 px, smaller than help text (18.9 px) and inputs (21.6 px). The privacy error appears only in the top summary.
- Screenshots: `…\pass3\phone-intake-filled-full.png`, `…\pass3\phone-intake-errors-view.png`.
- File: `src/pages/PreConsulta.tsx` (l.72, 120–126, 205); message text comes from `supabase/functions/_shared/intakeForm.ts`, so map it on the client.
- Change: clear a field's error on change; messages like "Informe seu nome completo" and "CPF inválido — confira os 11 números"; label `text-base font-medium`; privacy error under its checkbox; CPF mask.
- Effort M.

**[P2] 18. Pre-consultation: weak trust signals and an abrupt ending** — phone.
- No clinic logo. The footer "Formulário seguro do Cortex · Aviso de privacidade" names a brand the patient does not know and wraps into two columns.
- Error and invalid-link screens show no clinic at all. Success says only "Respostas enviadas / Obrigado! Recebemos suas respostas."
- Screenshots: `…\pass1\phone-intake-public.png`, `…\pass3\phone-intake-success.png`, `…\pass3\phone-intake-server.png`.
- File: `src/pages/PreConsulta.tsx` (l.128–168).
- Change: clinic logo and name on every state; "3 partes · cerca de 5 minutos" under the intro; stacked footer "Suas respostas vão direto para a clínica. / Aviso de privacidade". Success: "Pronto! A Dra. X recebe suas respostas antes da consulta de sexta, 13/11, às 09:00. Pode fechar esta página. Para corrigir algo, abra o mesmo link."
- Effort S.

**[P2] 19. `/seguranca` at 1920 has an empty sidebar** — wide.
- No Início, Agenda, Pacientes or area switcher; the breadcrumb says "Sua conta" and "Cortex · Ambiente clínico". The only way back is the logo.
- Screenshot: `…\pass1\wide-security.png`.
- Files: `src/App.tsx` (the route renders outside `ClinicAccessGate`), `src/components/WorkspaceShell.tsx` (l.49–64).
- Change: when access is unknown still render "← Voltar ao início" and the Consultório group.
- Effort S.

**[P2] 20. Password change is promised but does not exist** — Configurações.
- "Segurança e privacidade — Senha, segundo fator…" leads to a page with two cards, then to `/seguranca`, which has only "Adicionar autenticador". I found no change-password code for a signed-in user.
- Screenshots: `…\pass4\laptall-settings-seguranca.png`, `…\pass1\wide-security.png`.
- Files: `src/pages/Settings.tsx` (l.82), `src/pages/AccountSecurity.tsx`.
- Change: add an "Alterar senha" card on `/seguranca`, and link the settings row straight there.
- Effort M.

**[P2] 21. "Implantação" jargon with no way to act** — Configurações and the home settings sheet.
- "Dados da implantação", "Implantação assistida", "fale com a equipe responsável pela implantação" with no contact, "Nenhum dado é alterado nesta tela", and a "Copiloto ao vivo — Desativado" card.
- Screenshots: `…\pass4\laptall-settings-implantacao.png`, `…\pass2\lap-home-settings-sheet.png`, `…\audit-doctor2\largo-configuracoes.png`.
- Files: `src/features/settings/sections.ts`, `src/features/settings/ClinicSetupSummary.tsx`, `src/pages/Settings.tsx` (l.43), `src/components/SpecialtySettingsSheet.tsx`.
- Change: rename to "Seu cadastro profissional — dados usados nas suas receitas e atestados"; add a button "Pedir correção ao suporte" with the real channel; remove the Copiloto card for doctors.
- Effort S.

**[P2] 22. Sidebar hides "Financeiro" at 1080 px height** — wide.
- The middle nav scrolls under the pinned footer with no cue; "Pré-consultas" is cut in half. On home, "Configurações" is cut the same way.
- Screenshots: `…\audit-doctor2\largo-agenda.png`, `…\audit-doctor\largo-inicio.png`.
- Files: `src/components/WorkspaceShell.tsx` (l.73–82), `src/components/PatientSidebar.tsx`.
- Change: item height 2.25rem and tighter group spacing at xl, or let the whole aside scroll.
- Effort S.

**[P2] 23. Home wastes its first screen on phone and duplicates the agenda on desktop** — `/`.
- Phone: logo, area switcher, eyebrow, greeting, date and buttons take 720 of 812 px; one appointment is half-visible.
- Wide: "Agenda de hoje" appears in both sidebar and main card. Settings and sign-out are bare icons.
- Screenshots: `…\pass1\phone-home.png`, `…\audit-doctor\largo-inicio.png`.
- Files: `src/components/WelcomeDashboard.tsx` (l.196–207), `src/components/PatientSidebar.tsx` (l.116–195).
- Change: phone header in one line ("Bom dia · qua, 11 nov") plus a full-width primary button, with the switcher inside "Mais". Hide the sidebar agenda while the dashboard is showing.
- Effort M.

**[P2] 24. Appointment status looks different in each place** — home vs agenda.
- "Agendado" is a blue bar in the sidebar, a grey pill in the home list and wine in the calendar. "Cancelado" (#606979) and "Realizado" (#475569) are nearly the same grey. Type is "Novo" in one list and "Primeira consulta" in another.
- Screenshots: `…\audit-doctor\largo-inicio.png`, `…\audit-doctor2\largo-agenda.png`.
- Files: `src/components/PatientSidebar.tsx` (l.40–46), `src/components/DailyAgenda.tsx` (l.12–13), `src/pages/Calendar.tsx` (l.76–79), `src/components/WelcomeDashboard.tsx` (l.45–50).
- Change: one shared map of label, colour and badge; "Cancelado" as outline with strike-through.
- Effort S.

**[P2] 25. Three formats for the last visit** — home, list, profile.
- "há 1 mês", "12/10/2026", "há 29 dias"; labels "Última Visita", "ÚLTIMA VISITA", "Última visita concluída"; "Sem consulta registrada" vs "Sem consulta concluída".
- Screenshots: `…\audit-doctor\largo-inicio.png`, `…\audit-doctor2\largo-pacientes.png`, `…\pass2\lap-profile-historico.png`.
- Files: `src/components/WelcomeDashboard.tsx` (`relativeDate`), `src/pages/PatientManagement.tsx`, `src/components/PatientProfileDrawer.tsx`.
- Change: one helper giving "12/10/2026 · há 29 dias"; one term, "Última consulta".
- Effort S.

**[P2] 26. Consultation screen: unclear first step and wrong tone** — `/?patient=…`.
- "Resumo Pré-Consulta" is an amber warning saying "Prontuário aberto para visualização. O resumo com IA é opcional e só será solicitado pelo botão abaixo."
- The main action is an unlabelled red circle explained by "Grave com o botão vermelho · Pergunta consulta a IA · Comentário vira anotação". The last evolution of a return patient is not on screen.
- Screenshots: `…\pass1\wide-chart.png`, `…\pass5\hd-chart.png`.
- File: `src/components/ChatPanel.tsx` (l.1693–1790, 2299–2327).
- Change: a neutral card "Última consulta: 12/10/2026 — Retorno com exames [Ver evolução] [Resumir com IA]"; the mic becomes a pill "Gravar consulta" from `sm` up; delete the hint line.
- Effort M.

**[P2] 27. Issued documents: revoke is an unlabelled icon beside copy and open** — profile › Documentos.
- The drawer header also uses 410 px on laptop and about 730 px on phone before content, and the "Documentos" tab touches its edge on phone.
- Screenshots: `…\pass2\lap-profile-documentos.png`, `…\pass2\phone-profile-geral.png`.
- Files: `src/components/PrescriptionList.tsx`, `src/components/PatientProfileDrawer.tsx` (l.328–489).
- Change: an "Abrir" text button plus a "⋯" menu with "Copiar código de validação" and red "Revogar documento…" with confirmation; header stats as one text line.
- Effort M.

**[P2] 28. Home error and loading states are scattered** — `/`.
- On failure: an unstyled red line "Pacientes indisponíveis. Tentar novamente" outside the layout, a yellow "Consultas para retomar" card with two retry controls, and the agenda card error.
- On every load, the "Consultas para retomar / Verificando consultas…" card appears and then vanishes, shifting the agenda about 175 px.
- Screenshots: `…\pass3\lap-error-home.png`, `…\pass3\lap-loading-home.png`.
- Files: `src/pages/Index.tsx` (l.376), `src/components/ConsultationRecoveryNotice.tsx`, `src/components/DailyAgenda.tsx`.
- Change: one banner inside the page, "Não foi possível carregar seus dados. [Tentar novamente]"; render the resume card only when there is something to resume or an error.
- Effort S.

**[P2] 29. Sharing and knowledge show an error and "nothing here" together** — `/compartilhamento`, `/conhecimento`.
- "A resposta de permissões não pôde ser validada. Tente novamente." has no button, while the cards below say "Nenhum prontuário compartilhado disponível" and "0 de 0 fontes disponíveis".
- A "Vincular equipe médica … não crie outra" form with "Criar equipe" is offered to a doctor already in a clinic.
- This state was triggered by the synthetic answer's shape; the design problem is real for any failed read.
- Screenshots: `…\pass1\wide-sharing.png`, `…\pass1\wide-knowledge.png`.
- Files: `src/pages/Sharing.tsx`, `src/components/ProtocolSharing.tsx`, `src/pages/KnowledgeBase.tsx`.
- Change: on failure hide the empty sentences and show one message with a retry button; show the team form only when the doctor has no clinic.
- Effort S.

**[P3] 30. Agenda grid details** — `/agenda`.
- The grid lists all 24 hours. Week events show "09:00 – 09:30 Paciente" with the name cut. The new-appointment dialog opened with a start of 05:21 (the current minute). The week starts on Sunday.
- Screenshots: `…\pass4\laptall-agenda.png`, `…\pass2\lap-agenda-new.png`.
- Files: `src/pages/Calendar.tsx`, `src/components/AppointmentModal.tsx`.
- Change: limit to 07:00–21:00; name first and time on a second line; default to the next half hour.
- Effort S.

**[P3] 31. Capitalisation and optional marks** — throughout.
- Title case in "Nova Consulta", "Novo Agendamento", "Paciente Existente", "Queixa Principal", "Perfil Completo & Arquivos", "Anamnese Social", against sentence case in "Novo paciente" and "Abrir agenda".
- Optional fields are marked "(opcional)", "(se conhecida)" or not at all. "Email" on login, "E-mail" in forms.
- Menu names differ from page titles: Conhecimento → "Biblioteca de protocolos", Modelos → "Modelos de documento".
- Screenshots: `…\pass2\lap-newconsult-new.png`, `…\pass2\lap-patients-new-invalid.png`.
- Change: sentence case, "(opcional)" only, "E-mail", and one name per page.
- Effort S.

**[P3] 32. Technical wording** — tools and return pages.
- Composer: "Assinatura ICP-Brasil será acoplada quando o provedor estiver conectado."
- Modelos: "Use títulos (##) … comandos condicionais entre parênteses".
- Conhecimento: "indexação concluída", "Fonte original não preservada", "1.200 caracteres".
- Segurança: "Desabilitar um fator exige uma sessão verificada".
- Return pages: "O provedor não devolveu a autorização." and "Código de autorização não recebido."
- Profile: "Insights da IA" and "no painel Perfil".
- Screenshots: `…\pass2\lap-composer.png`, `…\pass1\wide-templates.png`, `…\pass1\wide-knowledge.png`, `…\pass1\wide-signature-return.png`, `…\pass1\lap-oauth-callback.png`.
- Files: `src/components/DocumentComposerModal.tsx` (l.412–414), `src/pages/Templates.tsx`, `src/pages/KnowledgeBase.tsx`, `src/pages/AccountSecurity.tsx`, `src/pages/SignatureReturn.tsx`, `src/pages/GoogleOAuthCallback.tsx`.
- Change, for example: "O documento sai em PDF com QR Code de validação." and "A conexão não foi concluída. Volte à agenda e toque em Conectar Google de novo."
- Effort S.

**[P3] 33. Browser-native "confirm" for unsaved changes** — closing a dirty dialog or leaving a page.
- "Há alterações não salvas. Sair e descartar essas alterações?" appears in the browser's own box, while archiving a patient uses the app's styled dialog. Not screenshotted (native prompts cannot be captured); logged in `…\pass2\report-lap_phone-chart_patients_agenda.json`.
- Files: `src/hooks/useUnsavedChanges.ts`, `src/pages/Index.tsx` (l.92, 131).
- Change: the app's own dialog with "Continuar editando" / "Descartar".
- Effort M.

**[P3] 34. Loading and small-target polish** — several pages.
- Loading is a skeleton on home, "Carregando..." text on patients and "Carregando prontuário…" on the chart; the two full-screen loaders differ (brain icon vs "C").
- Search with no result says only "Nenhum paciente corresponde à busca".
- Dialog close is 22×22 px; the "Pergunta/Comentário" toggle is 38 px high.
- The composer dose field cuts "1 comprimido" to "1 compr".
- Screenshots: `…\pass3\lap-loading-patients.png`, `…\pass2\lap-patients-search-empty.png`, `…\pass2\lap-composer-generate-error.png`.
- Files: `src/pages/PatientManagement.tsx`, `src/App.tsx`, `src/components/ui/dialog.tsx`, `src/components/DocumentComposerModal.tsx`.
- Change: skeleton rows everywhere; "Nenhum paciente com 'zzzz'. [Limpar busca] [Cadastrar paciente]"; 44 px close target; wider dose field.
- Effort S.

## Works well, keep

- The archive confirmation explains consequence and recovery ("guarda obrigatória de 20 anos… restaurar em Ver pacientes arquivados"): `…\pass2\lap-patients-archive-confirm.png`.
- The document composer: clear type cards with validity rules and a fixed footer. Use it as the dialog template: `…\pass2\lap-composer.png`.
- The home empty state "Seu dia ainda está livre", and the patient-list error with retry: `…\pass3\lap-empty-home.png`, `…\pass3\lap-error-patients.png`.
- Phone patient list as cards, and phone agenda defaulting to day view: `…\pass4\phonetall-patients.png`, `…\pass4\phonetall-agenda.png`.
- Login error wording, and the neutral "se houver uma conta…" recovery text.
- The pre-consultation form itself: short, with the per-section note on who reads each part.
- The 404 page, the "Áreas de trabalho" switcher, and `PageHeading` on subpages.

## Not looked at

- **Recording and AI results:** active recording, the processing state, the SOAP review modal, the generated evolution with "Pós-consulta", the document preview and a real PDF. AI functions answer 503 in the synthetic backend.
- **Signature:** the signing flow, and success states of `/assinatura/retorno` and `/google-oauth-callback`; only the no-code error state was seen.
- **Dialogs not opened:** "Migração", patient import, template editor, add knowledge source, add authenticator, privacy export/delete, the Atestado and Exames composer variants. My selectors failed on some of these.
- **Captured but not opened:** most settings sections on phone, `/sobre` and `/aviso-de-privacidade` in full, the day view, the archived-patients list.
- **Login states:** sign-up is disabled in code. The recovery screen and the "link sent" notice were captured but not reviewed in detail.
- **Not measured:** keyboard focus order, screen-reader behaviour, colour contrast (judged by eye only), the on-screen keyboard on a real phone, long real-world data, dark mode.
- **Headless-browser artefacts:** date and time inputs showed "mm/dd/yyyy" and "AM/PM" because they follow the browser's language, not the app's; I did not count that as a finding.

**Tooling notes for the stock audit script:**
- `scripts/app-audit-browser.mjs` with `AUDIT_WORKSPACE_ROLE=doctor` stops at `/recepcao/financeiro` ("Financial tabs differ…") in the first viewport; with `AUDIT_WORKSPACE_INTERACTIONS=1` it stops at `/recepcao`. It therefore never reached 1280 or 375 px for the doctor role, so I have no `audit.json` findings for those sizes.
- Its full-page screenshots below 1728 px capture only the first screen, because subpages scroll inside `.clinic-subpage-shell`.
- My own scripts are in `…\scripts\`.

The repository was not modified. I read the coordination files but did not reply to open messages there, since this task was read-only.
