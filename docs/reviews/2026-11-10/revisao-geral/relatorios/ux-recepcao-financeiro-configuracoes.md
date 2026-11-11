# Relatório do revisor: UX da recepção, financeiro e configurações

Revisor independente, sem o contexto da conversa principal, só para leitura. Texto original do revisor (em inglês), de 11/11/2026. Os caminhos em `E:\Work\cortex-audit-tmp\` são arquivos de trabalho fora do repositório.

---

**Coverage note first:** this is based on about 60 screenshots I opened, out of roughly 400 captured, plus source reading. All screenshots are under `E:\Work\cortex-audit-tmp\review\ux-reception\` (`stock-reception\`, `stock-admin\`, `flows\`, `tour\`; my two scripts are `flows.mjs` and `tour.mjs` there). The repository was not modified. Source files below are under `E:\Work\Cortex\cortex\src\`.

Three things in the screenshots are capture artifacts, not findings:
- Native date/time fields show `mm/dd/yyyy` and `AM/PM` because headless Edge runs in en-US.
- `External operation blocked` and `Lote undefined criado` are the synthetic backend's answers.
- In `tour\*-full.png` the bottom bar floats mid-page because I expanded the scroll container to capture the whole page.

## Verdict

1. **What works:** one visual language across shell, headings and cards; loading, empty and error states exist almost everywhere; the finance lists and the "Receber pagamento" dialog are clear; the workspace switcher is good; the automatic audit found no unnamed controls or page overflow.
2. **What feels unfinished:** reception is forms over records, not a front-desk tool. The agenda is a card list with no time grid, booking is blind typing, and the WhatsApp inbox is read-only and never refreshes itself.
3. **Layout:** the 135% root font pushes the desktop layout to ≥1728 px. At 1366×768 (and at 1920 with 125% Windows scaling) the receptionist gets the phone layout, with the working list below the fold.
4. **Copy:** it explains internal mechanics ("leitura", "fluxo", "vínculo", "envio humano", "implantação") and sends the user to "equipe de implantação/Cortex" about ten times without any channel.
5. **Three changes with most impact:**
   - Desktop navigation from about 1200 px, with the queue above the fold.
   - Agenda as a time grid, with slot-based booking, visible errors and inline new contact.
   - An honest, live WhatsApp inbox: reply or say where to reply, auto-refresh, unread badge.

## Findings

**[P1] 1. WhatsApp inbox cannot reply and does not say so** — `/recepcao?view=conversations`, all widths.
- Seen: the conversation shows messages and admin actions but no composer. The description is "Consulte as conversas recebidas pelo número da clínica." The receptionist reads a message and has no way, or hint, to answer. `whatsappApi.ts` line 1 confirms the inbox is read-only by design.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r20-conversation-mine--w1920.png`
- Files: `features\reception\WhatsAppInbox.tsx`, `features\reception\WhatsAppMessages.tsx`
- Change: until sending exists, put a fixed notice at the foot of the conversation: "Por enquanto, responda pelo WhatsApp da clínica no celular ou no WhatsApp Web. Aqui você acompanha a conversa e define quem atende." Change the description to "Acompanhe as conversas do WhatsApp da clínica e defina quem atende cada uma." When sending ships, use a textarea plus "Enviar" pinned to the bottom.
- Effort: S (notice) / L (sending).

**[P1] 2. Inbox never updates itself and has no unread signal** — same route.
- Seen: the queue and agenda poll every 15 s, but the inbox queries have no `refetchInterval`; new messages appear only after clicking "Atualizar conversas". The "Conversas" toggle carries no unread count.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r19-conversations--d1366-fold.png`
- Files: `features\reception\WhatsAppInbox.tsx`, `features\reception\WhatsAppMessages.tsx`, `features\reception\ReceptionQueue.tsx`
- Change: poll the list every 15 s when no command is running; show "Conversas (3)" on the toggle; keep the manual button as an icon.
- Effort: M.

**[P1] 3. Desktop layout only from 1728 px; at 1366×768 the work is below the fold** — all reception/finance/settings routes.
- Seen: `html{font-size:135%}` scales every breakpoint, so `xl` is 1728 px. At 1366 there is no sidebar or brand, only a phone bottom bar with four items.
  - Queue: about 540 px of chrome; one third of the first card is visible.
  - Opened case: "Assumir atendimento" is below the fold.
  - Conversations and finance: zero rows visible; the six finance tabs wrap to 2×3.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r01-queue--d1366-fold.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r03-case-unclaimed--d1366-fold.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\tour\f01-faturar--d1366-fold.png`
- Files: `E:\Work\Cortex\cortex\tailwind.config.ts`, `index.css` (the `1728px` media queries), `components\WorkspaceShell.tsx`, `components\MobileSubpageNavigation.tsx`, `features\reception\ReceptionQueue.tsx`
- Change:
  - Add an unscaled screen (for example `nav: '1200px'`) and use it instead of `xl` in the shell, the bottom bar and the two CSS queries, with a 13rem sidebar.
  - In the queue, put the Atendimentos/Conversas toggle on the heading row, drop the description, and make the filters one borderless row (Situação, Médico, "Só os meus").
  - Target: at least three queue cards visible at 1366×768.
- Effort: M.

**[P1] 4. Agenda is a list of tall cards, not a schedule** — `/recepcao/agenda`.
- Seen: each appointment is a card about 270 px tall; below 1382 px they sit in one column, so 20 appointments is about 5,000 px of scroll. There is no time axis, free time is invisible, and week view is seven stacked lists. Day headings are bare "10/11/2026" with no weekday or "Hoje". Blocking time is admin-only.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r08-agenda-week--w1920.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r13-arrival--d1366-fold.png`
- Files: `features\reception\ReceptionCalendar.tsx`, `features\reception\ReceptionAppointmentCard.tsx`, `features\reception\dates.ts`
- Change:
  - Day view as a time grid, one column per doctor, compact rows: `09:00 · Nome · Retorno · [status]`, with the main action inline and the rest in a "⋯" menu.
  - Empty slots clickable to book.
  - Heading "Hoje · terça-feira, 10 de novembro".
  - Replace the subtitle "Confirmação humana · horários de São Paulo · somente agendas permitidas." with nothing, or "Horários de Brasília."
- Effort: L.

**[P1] 5. Booking is blind** — "Novo agendamento" and "Agendar consulta".
- Seen: Data/Início/Término are typed by hand and default to 09:00–09:30 even when that slot is taken. The dialog shows neither the doctor's day nor free slots; the conflict appears only after submit.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r09-booking-new-empty--d1366-fold.png`
- File: `features\reception\BookingDialog.tsx`
- Change: after doctor and date, show the day's free slots as chips ("09:30", "10:00"…) from the existing appointments read. Clicking fills Início and Término by type duration. Default to the next free slot. Keep manual fields under "Outro horário".
- Effort: M.

**[P1] 6. Booking error is rendered out of sight** — same dialog, 1366×768 and phone.
- Seen: the error notice sits under the dialog header (line 196), while the confirm button is at the bottom of a scrolled dialog. After a conflict the dialog looks unchanged; the user believes nothing happened and clicks again.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r11-booking-conflict--d1366-fold.png`
- Files: `features\reception\BookingDialog.tsx`; check the same pattern in `features\reception\NewCaseDialog.tsx` and `features\reception\ContactCorrectionDialog.tsx`
- Change: render the error directly above the footer buttons and scroll it into view and focus it.
- Effort: S.

**[P1] 7. A new caller cannot be booked from the agenda** — `/recepcao/agenda` → "Novo agendamento".
- Seen: the dialog only searches existing contacts ("Buscar contato por nome ou telefone") with no "create" option or hint. The working path is long:
  - Atendimentos → "Novo atendimento" → Novo contato → 3 fields → "Adicionar à fila".
  - Scroll → "Assumir atendimento" → "Agendar consulta".
  - Patient mode → relation → date/time → checkbox → confirm.
  - About 12 interactions across two dialogs and a page.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r09-booking-new-empty--d1366-fold.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r15-newcase-newcontact--d1366-fold.png`
- Files: `features\reception\BookingDialog.tsx`, `features\reception\ContactSearch.tsx`
- Change: when the search has no match, show "Cadastrar "<texto>" como novo contato" with name and phone inline. Booking from the agenda should not require a queue case. In the queue, "Assumir e agendar" as one button.
- Effort: M.

**[P2] 8. Admin sidebar hides Financeiro and Recepção; Financeiro has no navigation of its own** — `/financeiro`, `/configuracoes`, 1920×1080.
- Seen: the "Clínica" group is cut behind the fixed footer ("Pré-consultas" half visible), so the current page is never shown as active. On `/financeiro` the selector says "Financeiro" but the sidebar and bottom bar are the Consultório ones, with nothing active.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-financeiro.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-reception\desktop-recepcao-financeiro.png`
- Files: `components\WorkspaceShell.tsx`, `components\MobileSubpageNavigation.tsx`
- Change: when the workspace is "finance", show a finance group (A faturar, Cobranças, Lotes, Caixa, Relatórios, Cadastros) in place of the page tabs. Tighten sidebar items so three groups fit in 1080 px.
- Effort: M.

**[P2] 9. Case workspace has no clear next step** — `/recepcao?case=…`.
- Seen:
  - After claiming, "Agendar consulta" and "Concluir atendimento" are both outline buttons.
  - The status row ("Em atendimento / Aguardando paciente / Aguardando equipe / Cancelar demanda") is plain text, and the current one looks disabled.
  - "Cancelar demanda" and "Concluir atendimento" act on one click (`change.mutate` directly).
  - The box "Orientação para encaminhamento … Selecionar somente preenche o campo abaixo. Confira o profissional e use Encaminhar para confirmar." explains mechanics and suggests the doctor already set.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r04-case-claimed--w1920.png`
- Files: `features\reception\CaseWorkspace.tsx`, `features\reception\DoctorSuggestion.tsx`
- Change:
  - "Agendar consulta" primary.
  - Status as a labelled segmented control "Situação" with the current one filled.
  - "Concluir" and "Cancelar" behind a confirm or a 5 s "Desfazer" toast.
  - Hide the suggestion box when the case already has that doctor.
  - Move "Encaminhar para médico" and "Transferir para atendente" into a "Mais ações" disclosure.
- Effort: M.

**[P2] 10. Queue cards lack what a receptionist sorts by** — `/recepcao`.
- Seen: no waiting time (the item has `createdAt`), no phone, no search by name or phone.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\stock-reception\largo-recepcao.png`
- File: `features\reception\ReceptionQueue.tsx`
- Change: add "há 12 min" right-aligned, the phone under the name, and a search field in the filter row.
- Effort: S.

**[P2] 11. A confirmation checkbox on every booking, reschedule and contact fix** — dialogs.
- Seen: "Conferi o paciente, a relação do contato e o horário. Confirmo a reserva." plus the confirm button is two confirmations each time, and the checkbox is a 13 px native control in a 135% UI.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r12-reschedule--d1366-fold.png`
- Files: `features\reception\BookingDialog.tsx`, `features\reception\ReceptionCalendar.tsx`, `features\reception\ContactCorrectionDialog.tsx`
- Change: put the summary on the button itself ("Agendar ter 10/11 às 09:30 · Dra. Ana") and drop the checkbox. If the checkbox must stay by product decision, use the shared `Checkbox` at 1rem with a 44 px row.
- Effort: S.

**[P2] 12. "Confirmar presença" vs "Registrar chegada"** — appointment card.
- Seen: "Confirmar presença" reads as "the patient is here" but sets status "Confirmado". All four actions have equal weight. Status is plain grey text ("Chegada registrada · Agendado").
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r13-arrival--d1366-fold.png`
- File: `features\reception\ReceptionAppointmentCard.tsx`
- Change: rename to "Paciente confirmou"; make "Registrar chegada" the primary on today's appointments; status as coloured chips ("Agendado", "Confirmado", "Chegou 08:52", "Cancelado"); "Cancelar agendamento" in the "⋯" menu with a confirm.
- Effort: S.

**[P2] 13. Conversation detail reads like a record, not a chat** — `/recepcao?view=conversations`.
- Seen:
  - Four paragraphs: "Fila atual: / Situação atual: / Responsável atual: / Autorização de lembretes: Vigente".
  - Four outline buttons glued together.
  - Messages as full-width cards labelled "Recebida"/"Enviada" with near-identical backgrounds.
  - Documents show a filename with no way to open.
  - "Voltar à lista" appears next to a visible list.
  - Previews are not clamped: `block` overrides `line-clamp-2` on line 162.
  - "Até 50 conversas por página."
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r20-conversation-mine--w1920.png`
- Files: `features\reception\WhatsAppMessages.tsx`, `features\reception\WhatsAppInbox.tsx`
- Change:
  - One header line: "Agendamento · Em aberto · Com você · Lembretes autorizados".
  - Actions in a `flex gap-2` row.
  - Received bubbles left, sent right, time only for today.
  - Hide "Voltar à lista" from `lg` up.
  - Remove `block` from the preview span.
  - Delete the "Até 50…" lines.
- Effort: M.

**[P2] 14. Finance does not teach the sequence** — `/financeiro`.
- Seen: six equal tabs with no order or counts. "Marcar como enviado" appears only after "Baixar XML" (it is gated on `xmlHash`). The only guidance is a toast ("Baixe o XML e suba no portal do convênio.").
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-financeiro-lotes.png`
- Files: `features\billing\BillingPage.tsx`, `features\billing\BatchesTab.tsx`
- Change:
  - Number the flow tabs and add counts ("1 A faturar (2)", "2 Cobranças", "3 Lotes (1 a enviar)", "4 Caixa"), with Relatórios and Cadastros visually separated.
  - On each draft batch show a three-step line: "1 Baixar XML → 2 Enviar no portal do convênio → 3 Marcar como enviado", with step 3 visible but disabled until step 1.
- Effort: M.

**[P2] 15. Money and status are hard to scan in Cobranças** — `/financeiro`, Cobranças.
- Seen:
  - Amounts sit at four different x positions, depending on chip and button width.
  - "Em aberto" and "Paga em parte" are the same yellow.
  - The TUSS code leads the second line ("10101012 Consulta em consultório").
  - The glosa is small grey text.
  - "4 cobrança(s)".
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-financeiro-cobrancas.png`
- Files: `features\billing\ChargesTabs.tsx`, `features\billing\shared.tsx`
- Change: a fixed grid (description, amount right-aligned with tabular numerals, status 9rem, action 7rem); a different hue for "Paga em parte"; the code after the description in muted text; glosa as a red line "Glosa R$ 50,00 · Valor acima da tabela"; real plurals.
- Effort: S.

**[P2] 16. Reports: numbers left-aligned, codes without meaning** — Relatórios.
- Seen: table values are left-aligned; "R$ 0,00" is red; "Código 1705 · 1 guia(s)" has no description; "Faturado (4)" does not say what the 4 counts; there is no export.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-financeiro-relatorios.png`
- File: `features\billing\ReportsTab.tsx`
- Change: right-align numeric columns; red only when above zero; "1705 · Valor acima da tabela · 1 guia"; "Faturado · 4 cobranças"; add "Exportar CSV".
- Effort: S.

**[P2] 17. Charge dialog defaults to manual TISS entry** — "Cobrar".
- Seen:
  - "Procedimento" opens on "Outro procedimento (preencher)", exposing Guia / Tabela / Código / Descrição to a non-specialist even when the insurer has a price.
  - The "Tabela" trigger is centred and truncated ("22 · TUSS…").
  - "Total" sits higher than its neighbours.
  - "Quantidade" is disabled with no explanation.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\tour\f07-charge-dialog--1366-dialog.png`
- File: `features\billing\ChargeDialog.tsx`
- Change: preselect the insurer's consultation price for the appointment type and collapse Guia/Tabela/Código under "Detalhes da guia". Left-align the trigger with a full-width column; put Total in the same `Field` wrapper.
- Effort: M.

**[P2] 18. "Ask the Cortex team" with no way to ask** — Cadastros, Lotes (empty), Dados da implantação.
- Seen: about ten variations, with no link, phone or button. Examples:
  - "Nenhum convênio cadastrado. Solicite o cadastro à equipe Cortex."
  - "Solicite à equipe Cortex o cadastro dos convênios para montar lotes."
  - "Se houver informação incorreta ou pendente, solicite a correção à equipe de implantação antes de emitir o documento. Nenhum dado é alterado nesta tela."
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\tour\e12-cadastros-empty--d1366-full.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-config-implantacao.png`
- Files: `features\billing\SetupTab.tsx`, `features\billing\BatchesTab.tsx`, `features\settings\ClinicSetupSummary.tsx`, `features\settings\WhatsAppSettings.tsx`
- Change: one shared "Pedir ajuste" component — a button "Falar com a equipe Cortex" opening the support channel configured for the clinic, plus "Copiar pedido" with the field name prefilled. Say it once per page: "Estes dados são mantidos pela equipe Cortex. Para corrigir, fale com a equipe."
- Effort: M.

**[P2] 19. Cadastros shows raw registry codes** — Cadastros.
- Seen: "Conselho 06 · número 00000 · UF (código IBGE) 41 · CBO 225250", "tabela 22 · código 10101012", "Próxima guia 7". An empty CNES shows a label with no value while its neighbours say "Não informado".
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-financeiro-cadastros.png`
- File: `features\billing\SetupTab.tsx`
- Change: "CRM-PR 00000 · CBO 225250 (ginecologista)"; "TUSS 10101012"; "Número da próxima guia: 7"; always "Não informado" for empty values.
- Effort: S.

**[P2] 20. WhatsApp not connected is a dead end for both roles** — settings and inbox.
- Seen:
  - Admin: "Nenhum número conectado." plus "A equipe de implantação conecta e valida o número da clínica. Você não precisa informar IDs, tokens ou senhas nesta tela."
  - Receptionist: "Peça à administração para verificar a conexão e seu acesso ao WhatsApp da clínica." — which sends her to an admin who has no action either.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\tour\e13-whatsapp-not-connected--d1366-full.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\tour\e02-conversations-not-connected--d1366-full.png`
- Files: `features\settings\WhatsAppSettings.tsx`, `features\reception\WhatsAppInbox.tsx`
- Change:
  - Admin: "O WhatsApp da clínica ainda não foi conectado. A conexão é feita pela equipe Cortex." plus the button from finding 18, and a greyed preview of what will appear (lembretes, robô).
  - Receptionist: "O WhatsApp da clínica ainda não está conectado. Avise o administrador da clínica."
- Effort: S.

**[P2] 21. WhatsApp settings is one page of about 4,350 px at 1366** — `/configuracoes?secao=whatsapp`.
- Seen: connection, templates, the whole bot editor, hours, simulator, then "Automações da agenda" (the reminders a manager actually wants) at the very bottom. "Salvar fluxo" is mid-page. Template names appear as `lembrete_consulta pt_BR · utility`.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\tour\s02-whatsapp--d1366-full.png`
- Files: `features\settings\WhatsAppSettings.tsx`, `features\settings\FlowEditor.tsx`
- Change: three tabs — "Lembretes automáticos" (first), "Robô de atendimento", "Número e modelos" — with a sticky "Salvar" bar in the bot editor.
- Effort: M.

**[P2] 22. Indicators page is a wall of method notes** — `/recepcao/painel`.
- Seen:
  - Nav says "Indicadores"; the H1 says "Painel da recepção".
  - Copy includes "Leitura sob consulta. Atualize para conferir mudanças."; "Máximo de 31 dias; o instante final não é incluído."; "Uma reabertura substitui o ciclo anterior nesta leitura"; "Com envio humano"; "Sem amostra"; "Responsável sem acesso elegível".
  - Three "Não disponível" indicators each carry a justification.
  - The period needs four inputs.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\tour\p02-painel--d1366-full.png`
- Files: `features\reception\ReceptionDashboard.tsx`, `features\reception\ReceptionDashboardSummary.tsx`
- Change:
  - H1 "Indicadores do WhatsApp".
  - Presets "Hoje / 7 dias / 30 dias" with custom dates behind "Outro período".
  - Labels "Conversas recebidas", "Respondidas pela equipe", "Sem resposta da equipe", "Tempo até a primeira resposta (mediana)", with "—" when empty.
  - One "Como calculamos" disclosure holding all notes.
  - Remove the unavailable block, or reduce it to "Em breve: confirmações e faltas."
- Effort: M.

**[P2] 23. Five names for team access, and a cryptic page** — `/recepcao/equipe`, `/configuracoes?secao=equipe`, `/permissoes-recepcao`.
- Seen:
  - Names in use: "Equipe e permissões", "Equipe e acessos", "Delegações da recepção", "Permissões da recepção", "Pedidos de acesso e aprovações médicas".
  - Opened directly, `/permissoes-recepcao` says "Abra este fluxo pela equipe da clínica selecionada para escolher as contas corretas." and "Esta lista acompanha os pedidos feitos por este fluxo…", with no link.
  - The settings section stacks "Configurações" and "Equipe e permissões" at the same size.
  - Team form: "Nome da secretária", "Criar conta com acesso restrito", "Atualizar profissionais", "Conferir origem dos acessos de Secretária A"; a second doctor's checkbox is disabled with no reason.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-delegacoes.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-config-equipe.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\a01-team--w1920.png`
- Files: `features\reception\TeamSettings.tsx`, `features\reception\DelegationPermissions.tsx`, `features\reception\StaffAccessProvenance.tsx`, `features\settings\sections.ts`, `pages\Settings.tsx`
- Change:
  - Two names only: "Equipe da recepção" (accounts) and "Acesso à minha agenda" (the doctor's approval).
  - Delegation page text: "Para pedir acesso para uma secretária, abra Equipe da recepção." with a link.
  - Labels: "Nome", "E-mail de acesso", "Criar conta", "Atualizar lista", "Ver quem autorizou".
  - Hint under a disabled doctor: "Depende da aprovação do Dr. Bruno."
  - In settings, the section title replaces the H1, as "Dados da implantação" already does.
- Effort: M.

**[P2] 24. Finance breaks on the phone** — Caixa and Relatórios, 375 px.
- Seen:
  - Values split mid-number ("R$ 3.2 / 00,00", "- / R$ 2.8 / 50,00").
  - Expense titles truncate to "Al…" and "M…", and the meta text wraps one word per line, overlapping the amount.
  - Receipt rows lose the patient or description.
  - The undo icon and "Nova despesa" stick out of the card (page 9 px wider).
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\tour\f04-caixa--m375-full.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\tour\f05-relatorios--m375-full.png`
- Files: `features\billing\shared.tsx` (`Stat`: drop `[overflow-wrap:anywhere]`, use `whitespace-nowrap text-lg`), `features\billing\CashTab.tsx`
- Change: one stat per row below 400 px; stack expense rows (title, then meta, then amount + status + actions).
- Effort: S.

**[P2] 25. Checkboxes look like radio buttons, and there are three styles** — Lotes, automation dialog, bot hours, versus reception.
- Seen: the shared `Checkbox` uses `rounded-sm`, which with the large `--radius` becomes a circle. Multi-select lists ("Selecionar todas", "Primeira consulta / Retorno…", weekdays) therefore look single-choice. Reception uses 13 px native boxes; the queue filter uses a third, larger native one.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-financeiro-lotes.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\tour\s03-automation-editor--1366-dialog.png`
- Files: `components\ui\checkbox.tsx` (use `rounded-[4px]`), then replace native inputs in `features\reception\BookingDialog.tsx`, `features\reception\NewCaseDialog.tsx`, `features\reception\TeamSettings.tsx`, `features\reception\ReceptionQueue.tsx`
- Effort: S.

**[P2] 26. Errors and "no permission" are presented three ways** — finance, reception, team.
- Seen: finance prints the server text inline in red with a glued link; reception uses a boxed notice with a button; the team page for a receptionist is the bare sentence "Somente o administrador pode gerenciar a equipe." with no heading or way back.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r24-finance-error--d1366-fold.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r25-team-no-permission--d1366-fold.png`
- Files: `features\billing\shared.tsx` (`QueryState`), `features\reception\ReceptionNotice.tsx`, `features\reception\TeamSettings.tsx`
- Change: one shared notice. Error: "Não foi possível carregar o financeiro. Verifique a conexão e tente de novo." with a button, never raw server text. No permission: H1 plus "Esta página é só para o administrador da clínica." plus "Voltar aos atendimentos".
- Effort: S.

**[P2] 27. Contacts page is a dead-end directory** — `/recepcao/contatos`.
- Seen:
  - The only action is "Abrir atendimento": no "Agendar", no upcoming appointments.
  - The page's primary button is "Novo atendimento", not "Novo contato".
  - Cards stop at about 1,000 px on a 1920 screen.
  - Search is as-you-type here but needs a "Buscar" click in Conversas.
  - A contact was saved with phone "419": the client sends the phone as typed. Server validation was not exercised.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r17-contacts--w1920.png`
- Files: `features\reception\ContactDirectory.tsx`, `features\reception\ContactsPage.tsx`, `features\reception\NewCaseDialog.tsx`
- Change: rows instead of cards (name, phone, next appointment, "Agendar", "Abrir atendimento"); a client-side phone check ("Informe DDD + número, por exemplo (41) 99999-0000"); the same search behaviour in both places.
- Effort: M.

**[P2] 28. Phone queue: toggle wraps and the first case is a screen away** — `/recepcao`, 375 px.
- Seen: Atendimentos/Conversas stack into two rows; filters take about 350 px; the first card starts near y=910.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\tour\m01-queue--m375-full.png`
- File: `features\reception\ReceptionQueue.tsx`
- Change: `grid grid-cols-2` for the toggle; collapse filters behind a "Filtros" button on small screens.
- Effort: S.

**[P3] 29. "Novembro De 2026"** — finance period card.
- Seen: `capitalize` upper-cases "de".
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\tour\f01-faturar--d1366-fold.png`
- File: `features\billing\BillingPage.tsx` line 49
- Change: use `first-letter:uppercase` so it reads "Novembro de 2026".
- Effort: S.

**[P3] 30. Dialogs disagree on title, buttons and alignment.**
- Seen:
  - "Novo agendamento" opens a dialog titled "Confirmar agendamento".
  - Dismiss is "Voltar" in booking and contact dialogs, "Cancelar" in new-case and finance.
  - Remarcar and Bloquear have a left-aligned primary and no cancel.
  - The row button "Lançar retorno" confirms with "Fechar o lote".
  - The contact dialog shows "Recuperar cadastro do servidor" as a third action.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\a03-block-dialog--d1366-fold.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\flows\a05-contact-correction--d1366-fold.png`
- Files: `features\reception\BookingDialog.tsx`, `features\reception\ReceptionCalendar.tsx`, `features\reception\ContactCorrectionDialog.tsx`, `features\billing\BatchesTab.tsx`
- Change: title equals the trigger label; footer always right-aligned "Cancelar" plus primary; "Salvar retorno e fechar lote"; "Descartar e recarregar".
- Effort: S.

**[P3] 31. Defensive or internal copy in reception.** Exact replacements:

| Current | New | File |
|---|---|---|
| "Confira o paciente, a relação do contato e o horário antes de reservar." + "A reserva será feita após sua conferência. Todos os horários usam o fuso de São Paulo." | "Escolha o paciente e o horário." | `BookingDialog.tsx` |
| "Relação já confirmada. Este agendamento preserva o vínculo registrado." / "Recuperar vínculo selecionado" | "Relação já registrada no cadastro." / "Usar a relação registrada" | `BookingDialog.tsx` |
| "Cadastro administrativo. Os prontuários permanecem separados por médico." | "Pessoas que entram em contato com a clínica." | `ContactsPage.tsx` |
| "Vínculos administrativos confirmados" | "Pacientes ligados a este contato" | `CaseWorkspace.tsx` |
| "Seu rascunho de acompanhamento" / "Rascunho salvo para sua conta" / placeholder | "Anotação" / "Rascunho salvo" / "O que foi combinado com o contato? (sem informações clínicas)" | `CaseWorkspace.tsx` |
| "Assunto administrativo", "Tipo de demanda", "Motivo administrativo" | "Assunto", "Tipo", "Motivo" | `NewCaseDialog.tsx`, `ReceptionCalendar.tsx` |
| "Cancelar demanda" | "Cancelar atendimento" (drop "demanda" everywhere) | `CaseWorkspace.tsx` |
| "Recebimentos pela data de pagamento; despesas em aberto pelo vencimento e despesas pagas pela data do pagamento." | "Entradas e saídas do mês." (rule in a tooltip) | `BillingPage.tsx` |

- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\r06-booking-from-case--w1920.png`
- Effort: S.

**[P3] 32. Brand and header.**
- Seen: the sidebar reads "CORTEX · AMBIENTE CLÍNICO" in Recepção and Financeiro; below 1728 px there is no clinic brand at all; "Sair" is a lone unlabelled icon at top right, one click from logging out.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\stock-reception\largo-recepcao.png`
- Files: `components\BrandLockup.tsx`, `components\WorkspaceShell.tsx`
- Change: tagline "com Cortex"; compact logo in the narrow header; "Sair" with a label, or inside a user menu.
- Effort: S.

**[P3] 33. Three segmented-control patterns and two select styles.**
- Seen: Atendimentos/Conversas is filled-versus-outline buttons; Dia/Semana is two buttons about 600 px wide; finance uses tabs. Reception uses native `<select>` (smaller `text-xs p-2` inside the case); finance uses the styled Select.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\stock-reception\desktop-recepcao-agenda.png`
- Files: `features\reception\ReceptionQueue.tsx`, `features\reception\ReceptionCalendar.tsx`, `features\reception\CaseWorkspace.tsx`
- Change: use `Tabs` for the view switches (Dia/Semana inline, `w-auto`); one select component at `min-h-11`.
- Effort: S.

**[P3] 34. Disabled primaries are pale and unexplained.**
- Seen: "Criar conta com acesso restrito", "Aplicar período", "Criar lote" and "Registrar anotação" render as white on beige with no hint of what is missing.
- Screenshot: `E:\Work\cortex-audit-tmp\review\ux-reception\flows\a01-team--w1920.png`
- Files: `features\reception\TeamSettings.tsx`, `features\reception\ReceptionDashboard.tsx`, `features\billing\BatchesTab.tsx`
- Change: a helper line beside each ("Preencha nome, e-mail e ao menos uma agenda." / "Selecione ao menos uma guia.").
- Effort: S.

**[P3] 35. Settings overview and deployment page details.**
- Seen: the "Acessar seção" select duplicates the cards on the overview; the "Campos essenciais cadastrados" chip sits above "CPF … Não cadastrado"; the "Copiloto ao vivo — Desativado" card explains a feature the clinic cannot turn on.
- Screenshots:
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-configuracoes.png`
  - `E:\Work\cortex-audit-tmp\review\ux-reception\stock-admin\largo-config-implantacao.png`
- Files: `pages\Settings.tsx`, `features\settings\ClinicSetupSummary.tsx`
- Change: hide the select on the overview; chip "Falta: CPF" when a field is missing; remove the Copiloto card.
- Effort: S.

## Works well, keep

- Workspace switcher with one-line descriptions (`flows\a07-areas--w1920-fold.png`) and the phone "Mais" sheet.
- "A faturar" rows with the inline warning "Só a chegada foi registrada; confira se a consulta aconteceu antes de cobrar."
- "Receber pagamento" dialog: prefilled balance, four fields, clear primary.
- "Nova automação" dialog copy ("Nada sai entre 20h e 8h: a mensagem espera o horário.").
- Pré-consultas list: status chips and one clear action per row.
- Settings overview grouping and the "Todas as configurações" back link.
- Visible gold focus ring; `aria-label` on icon buttons; no text under 12 px (smallest is 13.5 px).
- Draft autosave on case notes; 15 s refresh on queue and agenda.

## Not looked at

- **Captured but not opened:** `/seguranca`, `/privacidade`, `/compartilhamento`; settings sections preferências, conexões, permissões, sobre; the intake form editor (`tour\s04-intake-editor--d1366-full.png`); contact-links dialog; team credentials dialog; pré-consulta answers dialog; most 375 px reception shots.
- **Not captured:**
  - Charge-dialog validation errors (my script clicked close instead of submit).
  - "Marcar como enviado", NFS-e and "Corrigir retorno" dialogs.
  - The "Primeiro cadastro com este médico" branch of booking.
  - WhatsApp transfer, queue-change and close confirmations, and the template catalogue.
  - Doctor-role finance.
  - 320 px.
  - A keyboard-only pass.
  - Real pt-BR date/time rendering.
- **Unverified:** whether "Cancelar agendamento" asks for confirmation; server-side phone validation.
