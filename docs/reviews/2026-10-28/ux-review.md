# Cortex UX and accessibility reassessment — 2026-10-28

Review baseline: local remediation branch at `1ad2116`. This is a review and product roadmap, not an implementation. No production records, provider accounts or patient data were used.

## Evidence and limits

Reviewed the application routes and the primary patient, consultation, document, scheduling, template, knowledge and privacy interfaces, their relevant tests, and the preceding remediation report. Existing fixes for patient-bound note drafts, explicit error states, review-before-finalization, accessible core buttons, dialog scrolling and reduced motion were credited rather than relisted as open defects.

The patient deep-link issue below was reproduced by running the production `Index` component with the existing synthetic test harness. A desired-behavior test failed: after selecting Patient B and refreshing patient data, the heading returned to Patient A. The temporary test was removed afterward. Evidence: [ux-route-repro.txt](ux-route-repro.txt). This test used mocked child components and mocked Supabase responses; it establishes the parent state bug, not a complete browser workflow.

Other findings are source-confirmed unless explicitly identified as rendered. Color ratios were calculated from the source RGB/HSL values using WCAG relative luminance. The parent review confirmed the tablet layout finding below in the browser. Screen-reader output and mobile keyboard/safe-area behavior still require their own verification.

Product scope clarified during this review: launch for doctors with separate patient lists and explicit patient sharing. Shared records should never imply clinic-wide visibility. PersonalMed 2005 migration is a later project; receptionist workflows are not an initial launch requirement.

## Confirmed findings, highest priority first

### UX-01 — P1: a deep link can switch the active patient back after a refresh

`src/pages/Index.tsx:103` — `activatePatient` changes local selection but does not update the `patient` URL parameter.

`src/pages/Index.tsx:195` — the deep-link effect depends on both the URL ID and the patient list, so a refreshed list replays the stale URL selection.

Reproduction: enter `/?patient=A`; choose Patient B; update any patient data so the patients query returns a changed array. With no unfinished work, the app changes back to A automatically. With unfinished work, it can present a misleading patient-change prompt caused by a refresh. The existing patient-directory links make this an ordinary entry path. The regression harness confirmed that B was selected before invalidation and A was rendered afterward.

Fix direction: use one authoritative selected-patient identity, synchronized with the URL. Opening, switching, Home, Back and Forward must have explicit semantics. Query refresh must refresh the selected record, never choose another patient. A missing/deleted URL patient must produce an explicit unavailable state.

Acceptance: open A by URL, switch to B, refresh either patient, complete a note and invalidate queries; B remains active. Browser Back/Forward selects the expected record with the same unsaved-work policy. The URL, header, snapshot, composer and recording owner always agree.

### UX-02 — P1: patient-directory edits can silently overwrite newer demographic data

`src/pages/PatientManagement.tsx:60` — the editor submits all captured fields.

`src/pages/PatientManagement.tsx:72` — update filters only by ID, without an expected revision or returned-row check.

Reproduction: open the same patient in two tabs. Tab 1 changes the name or status and saves. Tab 2 changes only profession and saves its older complete form. Tab 1's newer name/status is replaced. The profile drawer already implements a conflict-aware revision flow; this editing path does not. A successful zero-row update after deletion may also be presented as a saved edit.

Fix direction: capture the loaded revision; update with ID + revision and inspect the returned row. Preserve the draft on conflict and show old/current/proposed values before an explicit retry. Reuse the current patient conflict policy rather than inventing another one.

Acceptance: a two-tab test preserves both users' data or reports a conflict. A deleted row never produces a success toast. No automatic full-form overwrite is offered as the default resolution.

### UX-03 — P2: modal-close warnings do not protect route exit or page refresh consistently

`src/pages/PatientManagement.tsx:134` and `src/components/AppointmentModal.tsx:320` — dirty guards run only through the dialog close callback.

`src/pages/Templates.tsx:72` and `src/pages/KnowledgeBase.tsx:65` — `beforeunload` protects a reload, but no router blocker protects a same-document Back navigation.

Reproduction: navigate to the patient directory or calendar, edit a form, then use browser Back or reload instead of the modal close button. These editors have no page-level route/unload guard. Templates/knowledge warn on reload but can still lose their drafts on an SPA history transition. The protected `Index` route does not cover these separate routes.

Fix direction: shared dirty-work registration at the route boundary, with save/discard/stay behavior tailored to each editor. All input paths must use the same rule. Avoid promising durability for text that exists only in memory.

Acceptance: Escape, overlay, close icon, browser Back/Forward, reload and route navigation all have defined tested outcomes; failed saves retain the form. In-progress uploads/generation have a clear state and cannot be silently discarded.

### UX-04 — P2: completed and elapsed appointments appear as pending reminders

`src/components/WelcomeDashboard.tsx:119` — reminder eligibility excludes only already-sent and cancelled appointments, not `realizado` or elapsed appointments.

Reproduction: an appointment earlier today is marked completed with no reminder flag. The dashboard still offers “Lembrar,” allowing a reminder for a visit that already occurred. WhatsApp correctly remains unconfirmed after opening a link; that repaired behavior should be retained.

Fix direction: define eligibility by appointment lifecycle and an explicit time window. Treat reminders, follow-up contact and missed-visit outreach as distinct actions. Give users a channel choice when both phone and email exist.

Acceptance: completed/cancelled/elapsed visits do not receive ordinary upcoming-visit reminders; rescheduling updates eligibility; any follow-up action is explicitly named. Server-side validation must enforce the same policy.

### UX-05 — P2: patient and medication lookup errors are visually indistinguishable from unavailable data

`src/pages/Calendar.tsx:141` — patient query exposes only `data`, so patient-load failure leaves an empty selector without retry/error feedback.

`src/components/DocumentComposerModal.tsx:127` — catalog query discards `error` and replaces hits with an empty array. The result panel disappears when no hits remain (`:319`). A failed lookup and a valid zero-result search look the same.

Fix direction: explicit loading, empty, failed and retry states. An unavailable patient list must not encourage creating a duplicate record. Medication search should distinguish unavailable catalog from no matching medication and preserve the typed term.

Acceptance: simulate a 503 and a valid empty response for each lookup; the UI communicates different states. Retrying uses the original search. Existing selections and dosage edits remain intact.

### UX-06 — P2: normal text fails the contrast target on primary buttons and calendar events

`src/index.css:13`, `src/index.css:40`, `src/components/ui/button.tsx:12`, `src/components/ui/button.tsx:19` — white normal text on primary/medical blue `hsl(210 65% 50%)` is **4.11:1**.

`src/pages/Calendar.tsx:59`, `src/pages/Calendar.tsx:226` — white event text has the following calculated ratios:

| Appointment status | Background | White-text ratio |
|---|---|---:|
| Scheduled | `#3B82F6` | 3.68:1 |
| Confirmed | `#10B981` | 2.54:1 |
| Cancelled | `#94A3B8` | 2.56:1 |

These are active event labels around 12px and normal-size button labels, not disabled or large decorative text. WCAG's normal-text contrast target is at least 4.5:1. Use darker backgrounds or darker foregrounds while retaining a consistent semantic palette. Check muted opacity text across the app as part of the same pass; a small font does not justify lower contrast.

Acceptance: token-level contrast checks plus a rendered accessibility scan of enabled states, hover/focus states and calendar statuses. Avoid solving this solely with heavier font weight.

### UX-07 — P2: key state is expressed only visually

`src/pages/Calendar.tsx:171` — event titles contain the appointment title but not the status. Color supplies the status distinction, and the legend is hidden on mobile (`:253`).

`src/components/PatientSidebar.tsx:162` — desktop agenda status is a color stripe; the accompanying sublabel is the visit type, not the appointment status.

`src/components/ChatPanel.tsx:1537` — the Question/Comment controls change behavior but have no `aria-pressed`, selected radio or tab semantics.

`src/pages/Index.tsx:383` — mobile active view is distinguished by styling without `aria-current` or an equivalent selected state.

Fix direction: visible text or distinguishable symbols for appointment status, programmatic selected states for mode/view controls, and consistent accessible names. Question and Comment deserve especially clear differentiation because one asks the assistant while the other writes clinical material.

Acceptance: users can identify appointment status without color and know the active input mode with a screen reader. Every action is keyboard reachable with a visible focus indicator.

### UX-08 — P2: recording can continue while all recording controls and status are hidden

`src/pages/Index.tsx:314` — keeping `ChatPanel` mounted across local tabs correctly preserves capture.

`src/pages/Index.tsx:379` — the alternate Home/Menu/Profile views have no global active-recording banner, elapsed timer or stop action, even though `captureBusy` is available in the parent.

This is a discoverability and recording-awareness issue, not a claim that audio changes patient ownership. A clinician who opens Profile or Home should still see that a recording is active and which patient it belongs to.

Fix direction: persistent capture status above the local navigation, with patient identity, elapsed time, audio-source state and a “Return to recording”/stop action. Preserve the existing guard against leaving the route with unsaved captured audio.

Acceptance: every local tab clearly shows ongoing capture. Stopping returns to a visible processing/recovery state; capture failure cannot appear as a normal idle screen.

### UX-09 — P2: document preview actions lack complete accessibility and failure recovery

`src/components/DocumentPreviewModal.tsx:120` — custom icon-only close button has no accessible name, in addition to the shared dialog close button.

`src/components/DocumentPreviewModal.tsx:67` — clipboard rejection is not caught, so blocked clipboard access has no actionable feedback.

`src/components/DocumentPreviewModal.tsx:75` — a blocked print popup returns silently.

`src/components/RecordingModeDialog.tsx:32` and `src/components/DocumentPreviewModal.tsx:117` — descriptive visible paragraphs are not wired as dialog descriptions. Shared close labels remain English (`src/components/ui/dialog.tsx:47`, `src/components/ui/sheet.tsx:66`) in a Portuguese UI.

Fix direction: one clearly named close action, localized shared primitives, programmatically associated descriptions, and visible copy/print failure fallback. This should be one reusable document-action pattern.

Acceptance: accessibility tree contains a meaningful dialog name/description and no unnamed buttons; mocked clipboard denial and blocked popups show a recoverable error; generated content stays available.

### UX-10 — P2: the three-column tablet layout compresses the clinical composer

`src/pages/Index.tsx:294` and `:350` — the workspace reserves at least 260px + 270px for side panels from the 768px breakpoint.

The parent review rendered the current workspace at **820×900**. The center was 290px wide, the question input measured **66px**, and the usage chip was cropped behind the right panel. Evidence: [workspace-tablet-820.png](workspace-tablet-820.png). This is a rendered finding, not just breakpoint arithmetic.

Fix direction: collapse patient context into a drawer or tab at intermediate widths and reveal three columns only when the clinical composer retains a usable minimum width. Preserve patient identity and active capture status in the central view.

Acceptance: at 768, 820 and 1024px, all composer controls and quota state remain visible, the input supports meaningful text review, and no critical action lies beneath another panel. Verify 200% zoom as well as device widths.

## Layout and information-architecture improvements to validate

These are product recommendations, not asserted browser failures.

1. **Shared patient orientation:** implement “Meus pacientes” and “Compartilhados comigo” filters; keep record owner and the current viewer's role visible in the patient workspace. Shared access should be an intentional action for a chosen doctor, with an explicit scope and revocation path.
2. **Persistent navigation:** most secondary routes replace the workspace with a Back button. Give desktop users a shared shell and mobile users stable top-level navigation. Returning from Calendar, Templates or Knowledge should restore the active patient and view, subject to the same work guard.
3. **Patient identity:** the chat header currently shows name and a constant “Em atendimento” badge (`ChatPanel.tsx:1076`). Add a second stable identifier with an explicit unknown state; distinguish viewing a chart from an active consultation. Do not invent dates of birth from an approximate stored age.
4. **Clinical legibility:** many metadata labels are 9–11px with additional opacity. Use readable type and contrast for medication instructions, review notices and dates, not only headings. Offer comfortable/compact density after the base layout is accessible.
5. **Main-content navigation:** the primary workspace has no `main` landmark or skip target; add named landmarks and a keyboard route to the active clinical content. Retain the good message log/live announcements already implemented.
6. **Touch and viewport polish:** add safe-area padding to the mobile bottom bar, verify software-keyboard resize, and validate the recording-mode dialog in short landscape viewports. The latter has no explicit maximum height/scroll area (`RecordingModeDialog.tsx:29`).
7. **Data loading at scale:** several screens fetch every row then paginate/render locally. Bounded server-side searches and cursor pagination should precede a large-practice rollout. Template rendering currently maps the complete filtered set (`Templates.tsx:228`).
8. **Trust and help:** replace unsupported absolute claims such as “100% em conformidade com LGPD” (`About.tsx:81`) with statements supported by documented controls and reviewed policy. Provide an actual support/export request path where privacy copy requires it (`DataPrivacy.tsx:124`). This review does not determine legal compliance.

## Better existing functionality: prioritized vertical slices

Effort is relative engineering scope, not a delivery-date promise: S = small interaction; M = several coordinated components/API changes; L = product capability requiring multiple independently shippable slices.

| Priority | Improvement | Concrete user outcome | Scope / prerequisites | Acceptance criterion |
|---|---|---|---|---|
| Now | Patient workspace with authoritative route state | A clinician always knows whose chart and encounter are open | M; UX-01 and conflict policy first | Deep links, selection, refresh and history navigation preserve the intended patient |
| Now | Consistent save/conflict/leave behavior | Typed work has a predictable fate | M; shared dirty-work API | All editor exit paths tested; conflict never clears a draft |
| Now | Accessible clinical tokens and controls | Critical text and modes are readable and discoverable | M; contrast/state findings | Normal text meets target contrast; keyboard and screen-reader checks pass |
| Next | Consultation review workspace | Review source transcript beside editable draft with clear unresolved items | L; durable draft/version model exists | Every proposed change is reviewable; unresolved input is visible; final save requires clinician confirmation |
| Next | Unified document center | Find prescriptions, referrals, summaries, exam requests and their status from one patient tab | L; define document metadata/lifecycle | Search/filter/download work; generated/unsigned/revoked/legacy states remain explicit |
| Next | Scheduling with meaningful reminder states | Reschedule once, see sync state, choose the correct communication channel | M/L; backend sync lifecycle | A changed appointment cannot retain an obsolete confirmation/reminder state; failure has retry |
| Next | Template editor with blank/manual creation, preview and versions | A clinician can create and maintain a reusable template without spending AI quota | M; source review and privacy checks | Example output is reviewed before save; historic consultations retain their original template version |
| Next | Knowledge document management | Open, inspect, edit/reindex, retry failures and retire outdated knowledge | L; provenance/version fields | Search result shows source/version; failed ingestion preserves text and offers retry |
| Next | Guided setup grounded in actual events | Setup completion reflects a saved first consultation, not patient status | S/M | Completion derives from actual saved records; dismissed help can be reopened |
| Later | Personal workspace preferences | Clinicians choose compact/comfortable layout and common actions | M; accessible base first | Preferences persist per account; resetting them cannot affect clinical records |

## New functionality worth building

| Priority | Capability | Why it fits the existing product | Smallest useful release | Dependency and success measure |
|---|---|---|---|---|
| High | Follow-up worklist | Dashboard already shows return labels and AI pending items, but those are not accountable tasks | Clinician-confirmed task with patient, owner, due date, status and source consultation | Explicit review of AI proposals; measure completed-on-time and overdue tasks, never auto-act on clinical suggestions |
| High | Pending-work inbox | Preserved consultations and failed document operations currently require reopening the right patient | List recoverable drafts, reviews waiting approval and failed uploads with safe resume links | Draft ownership/lifecycle; verify every resume link opens the original patient and draft |
| High | Longitudinal patient timeline | Notes, consultations, files and generated documents are spread across surfaces | One filtered chronological view with record type, author, date and revision indicator | Source timestamps and revision data; opening an item preserves context and origin |
| High | Patient identity quality tools | Fast registration currently accepts a name and age without a duplicate-resolution workflow | Show possible duplicates before creation and allow explicit “different person” | Matching is advisory; no automatic merge. Any later merge requires reversible audited design |
| Medium | Source-linked assistant responses | Knowledge ingestion and clinical retrieval are more useful when the source can be checked | Show the records/passages used, their date and a one-click source view | Backend must return real provenance; never fabricate citations. Measure source-opening and clinician correction rates |
| Medium | Controlled patient communication center | WhatsApp links and documents already exist but have disconnected state | Physician-approved summary, recipient preview and explicit prepared/opened/sent-confirmed states | Consent/contact checks and delivery-provider evidence; a link opening is never counted as delivery |
| Medium | Pre-visit intake | New consultations capture only a complaint and limited registration data | Short clinician-configured questionnaire whose answers enter a review queue | Secure patient identity/link expiry; responses remain patient-reported until reviewed |
| Medium | Keyboard command search | Frequent actions are distributed across sidebars and secondary pages | Search patients and navigate to existing actions with visible keyboard help | Respect active recording/unsaved work; no PHI in analytics or external search |
| Launch foundation | Explicit doctor-to-doctor patient sharing | Launch requires separate doctor lists with intentional sharing | Owner invites a specific doctor with an explicit access scope; recipient sees “Shared with me”; owner can inspect/revoke access | Define permission semantics first; no clinic-wide discovery. Access-boundary tests must cover list, chart, AI context, files, documents and revocation |

Do not prioritize autonomous diagnosis, autonomous treatment changes, automatic chart merges, background patient messaging or unrestricted offline PHI caching. Their dependencies and risk exceed the current workflow foundations. This is a sequencing recommendation, not a ban on future carefully designed functionality.

For the clarified sharing scope, the shared-patient UX must answer four questions without ambiguity: who owns the record, which doctor is viewing it, what actions that doctor can take, and whether access is still valid. The share modal should identify the intended doctor before granting access, summarize the selected scope, and show active grants with a revoke action. Clinical changes need visible author attribution. A recipient must not be allowed to re-share a record unless that privilege is explicitly part of the policy. Revocation needs a visible “access removed” state that clears cached record content and preserves only work that the policy allows the doctor to retain. These are acceptance requirements for the new feature, not capabilities present in the current app.

## Suggested UX validation plan

Use synthetic patients with duplicate names, long names, empty/unknown fields, allergies, many medications, old consultations and pending audio drafts. Test normal, slow, failed and interrupted network paths.

- **Patient context:** deep link A → switch B → save → refresh → browser Back; verify identity in header, form, payload and final record.
- **Clinical work:** begin capture → inspect profile → return → stop → recover after failed processing → review → save; verify that capture status and save state remain visible.
- **Scheduling:** patients lookup failure, no matches, completed appointments, reschedule and provider failure; verify distinct states and safe retry.
- **Documents:** empty catalog versus failed catalog; long dosage text; blocked popup/clipboard; unsigned/revoked document labels; clear patient/recipient preview.
- **Accessibility:** keyboard-only completion, NVDA or VoiceOver checks, 200% zoom, reduced motion, all status colors, dialog focus return and inline errors.
- **Responsive:** 390×480, 390×844, 768×1024, 820×900 and 1440×900; mobile keyboard open and device safe areas.
- **Scale:** realistic 1,000+ patient fixture, long timeline and template list; measure interaction delay and time to find a patient before setting a performance budget.

Usability metrics should be gathered with consent and without clinical text: time to open the correct chart, time from recording stop to approved note, recovered versus abandoned drafts, failed-save recovery, reminder eligibility errors, and task completion rate. Baselines are not yet measured; do not claim improvements in percentages until observed.

## References

- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), retrieved 2026-10-28: interaction and accessibility review checklist.
- [W3C WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): normal-size text target and contrast interpretation.
- [W3C WCAG 2.2 use-of-color guidance](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html): visible alternatives to color-coded meaning.
