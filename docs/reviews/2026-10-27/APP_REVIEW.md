# Cortex application review

Reviewed 27 October 2026, America/Sao_Paulo. Repository revision: `4117cea`.

Cortex has a useful product foundation, but the reviewed source is not ready for unrestricted use with real patient records. The release blockers are private storage access through privileged endpoints, incomplete ownership checks across related records, patient context crossing between workflows, and failure paths that can lose or incorrectly finalize clinical work. These defects deserve attention before cosmetic changes or additional features.

This review covers security, privacy, clinical data integrity, functionality, UI/UX, accessibility, performance, testing, architecture, and operational readiness. Application source was left unchanged. The files in this folder contain the review and its evidence.

## Assessment and scope

| Area | Assessment | Main reason |
| --- | --- | --- |
| Security and tenant isolation | Release blockers | Privileged storage access trusts writable paths; a related patient can belong to another user |
| Clinical data integrity | Release blockers | Patient switching retains drafts, briefings, or delayed results; medication reconciliation can retain an obsolete dose |
| Recording and AI reliability | Release blockers | Source audio is removed early; incomplete AI output can be treated as good and saved automatically |
| Documents and prescriptions | Release blockers | Client-writable lifecycle metadata; document clipping and silent list truncation |
| Privacy and deletion | Changes required | Stored documents can survive deletion; exports omit data and suppress read failures |
| Core functionality | Changes required | Settings writes conflict with migrations, callback/auth races, stale cache and reminder state |
| UI and accessibility | Changes required | Confirmed mobile dialog clipping, tablet overflow, unnamed controls, weak access to older charts |
| Performance and scale | Improvement needed | Large initial bundle; unpaginated clinical lists |
| Engineering assurance | Insufficient for the risk | Eight shallow tests; 54 TypeScript errors; lint fails; no checked-in CI workflow |

Priorities: **P1** means fix before a production release involving patient data; **P2** means fix in the next reliability/security cycle; **P3** means a planned improvement. No P0 incident or deployed compromise was established. Findings are source-confirmed unless marked as observed in the browser or requiring deployment verification.

Inspected all 19 Supabase Edge function handlers and 17 migrations, the shared helpers, all 11 route pages, the recording hook, patient/profile/file components, clinical document and prescription paths, imports, calendar, knowledge retrieval, configuration, and existing tests. Existing untracked `.agents/`, `.claude/`, `Cortex/`, `skills-lock.json`, and `supabase/.temp/` were preserved.

Browser checks used an isolated local Vite instance connected to a temporary synthetic backend, with two fictional patients. There were no production requests, real patient reads, external messages, real OAuth grants, or paid model calls. The mock validates interface behavior only; it cannot establish that real RLS, provider integrations, or deployed migrations work. Storage URL normalization was reproduced offline with the installed Supabase SDK and intercepted fetches. Edge functions import the floating `@supabase/supabase-js@2`, so the deployed resolution also needs checking.

## Verification results

| Check | Result | Interpretation |
| --- | --- | --- |
| `npm run build` | Pass | Vite produced a production bundle; this script does not run TypeScript checking |
| `npx tsc --noEmit -p tsconfig.app.json` | Fail, 54 diagnostics | Generated database types omit newer tables/RPCs; additional invalid assignments exist |
| `npm run lint` | Fail, 114 errors and 17 warnings | Includes a real conditional-hook defect, alongside typing/style debt |
| Default `npm run test -- --reporter=verbose` | Worker startup timeout | No tests completed in that initial run; an environment/worker failure, not proof of test failures |
| Tests with `--pool=threads --maxWorkers=1` | Pass, 8 tests in 2 files | Login rendering and patient mapping only |
| Coverage with a single worker | Pass | Reported 48.67% lines covers only instrumented imported modules, 113 lines in its denominator; it is not application-wide coverage |
| `npm audit --json` | 29 affected package entries: 19 high, 10 moderate | Registry advisories; individual reachability still needs triage |
| `npm audit --omit=dev --json` | 16 affected package entries: 13 high, 3 moderate | Production dependency classification includes transitive tooling; this does not mean 16 browser-exploitable vulnerabilities |
| Offline storage reproduction | Confirmed | Current audio prefix accepts traversal; SDK/Request normalizes paths into another tenant or bucket |
| Browser checks | Several defects confirmed | Wrong-patient note draft, desktop home failure, tablet overflow, unnamed mobile action, mobile integration absence, short-screen dialog clipping |

Build output: main JavaScript **737.59 kB**, **213.37 kB gzip**; calendar chunk **265.27 kB**, **81.90 kB gzip**; main CSS **105.16 kB**, **17.92 kB gzip**. These are transfer/build measurements, not measured production LCP or INP.

## Security and privacy findings

### S1 P1 Prescription paths permit privileged reads of other private objects

Evidence: [prescription RLS](E:/Work/Cortex/cortex/supabase/migrations/20260603000000_prescriptions.sql:39), [public validator download](E:/Work/Cortex/cortex/supabase/functions/validate-prescription/index.ts:110).

The prescription policy permits authenticated users to create/update their own rows, including `storage_path`, `secret_code`, and expiry. The public validator checks that user-chosen code, then downloads the referenced object with the service role. It never establishes that the object belongs to the row's user.

An attacker with an account, their own patient, and a known target object path can create an own-user row pointing at that object. A leading slash bypasses the database path uniqueness constraint while the SDK strips it. Dot segments can also cross the bucket boundary: `../patient-files/patients/VICTIM/document.pdf` normalizes from the prescriptions endpoint to the patient-files endpoint. The target path is a prerequisite; this finding does not provide object enumeration.

Fix: make creation, path, secret, and lifecycle fields server-owned. Derive a canonical path from trusted user and document IDs, and authorize the referenced object before every privileged read. Test leading slashes, dot segments, encoded traversal, cross-bucket paths, and foreign-user paths. See [offline reproduction](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/offline-storage-repro.mjs).

### S2 P1 Audio prefix checking does not establish storage ownership

Evidence: [prefix check](E:/Work/Cortex/cortex/supabase/functions/transcribe-consultation/index.ts:83), [privileged download](E:/Work/Cortex/cortex/supabase/functions/transcribe-consultation/index.ts:121).

`consultations/ATTACKER/../VICTIM/audio.webm` passes the current `startsWith` check. URL normalization removes `ATTACKER/..`, so service-role storage access targets the victim's audio. The endpoint's patient ownership check does not authorize the audio independently. Exploitation requires an authenticated account, an owned patient, available quota, and a known victim audio path.

Fix: accept a trusted recording ID instead of an arbitrary path, or enforce a canonical key grammar and use user-scoped storage access. The offline reproduction confirms unauthorized URL targeting, not a deployed read or deletion of a victim's recording.

The same design deserves correction in [document analysis](E:/Work/Cortex/cortex/supabase/functions/analyze-document/index.ts:86) and [knowledge ingestion](E:/Work/Cortex/cortex/supabase/functions/ingest-knowledge/index.ts:61): owning a metadata row does not prove ownership of its client-writable storage path.

### S3 P1 Appointment relationships can cross user ownership boundaries

Evidence: [foreign key and policies](E:/Work/Cortex/cortex/supabase/migrations/20260516000000_calendar_consultations_patient_fields.sql:40), [reminder join](E:/Work/Cortex/cortex/supabase/functions/send-appointment-reminder/index.ts:63).

Appointment RLS checks the appointment's `user_id` but does not require its referenced patient to have the same owner. An attacker who knows a foreign patient UUID can insert an own-user appointment referencing that patient. The reminder function scopes the appointment, then joins patient name/phone/email using the service role. Its WhatsApp response exposes the foreign patient's name and phone; the email path can send appointment content to the foreign patient's address.

Fix: enforce owner-consistent foreign keys or ownership-checking triggers, and authorize the joined patient inside the endpoint. Apply the invariant to consultations, files, and prescriptions as well. Add two-user negative tests for every relationship. No email was sent during this audit.

### S4 P1 Google OAuth codes are not bound to the initiating session

Evidence: [authorization URL](E:/Work/Cortex/cortex/src/pages/Calendar.tsx:203), [frontend callback](E:/Work/Cortex/cortex/src/pages/GoogleOAuthCallback.tsx:13), [token exchange and binding](E:/Work/Cortex/cortex/supabase/functions/google-oauth-callback/index.ts:21).

The authorization URL uses `state=user.id`, but neither callback validates state. There is no single-use transaction nonce or PKCE verifier. An attacker with an unused authorization code for their own Google account, issued for the app's client and registered redirect, can induce a logged-in victim to visit that callback. The backend binds the exchanged Google tokens to the victim's JWT identity, linking the attacker's calendar to the victim's Cortex account. Future sync can then export appointment titles and notes to that calendar.

Fix: create a random, expiring, single-use state bound to the authenticated initiating session; validate and consume it at the server before token exchange. Google's [web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) describes storing random state in the session and rejecting callback mismatches. Add PKCE and an explicit redirect origin allowlist. Test wrong state, replay, expired state, and a code from a different transaction.

### S5 P1 Prescription signature and validity metadata are client-writable

Evidence: [broad write policy](E:/Work/Cortex/cortex/supabase/migrations/20260603000000_prescriptions.sql:39), [manifest status](E:/Work/Cortex/cortex/supabase/functions/validate-prescription/index.ts:88).

Ordinary authenticated users can update their prescription's `status`, `signed_at`, `expires_at`, `created_at`, and secret. The public manifest reports `assinada` from this mutable status without checking a cryptographic signature. A user can therefore misrepresent an unsigned document's status or extend validity metadata. This does not forge a PDF signature or prove an external cryptographic validator would accept it.

Fix: restrict lifecycle changes to explicit server operations and a verified signing/revocation workflow. Client revocation should use a narrowly authorized action rather than granting arbitrary lifecycle writes.

### S6 P1 Deletion leaves clinical storage objects behind

Evidence: [account cleanup](E:/Work/Cortex/cortex/supabase/functions/delete-user-data/index.ts:63), [database deletion and success](E:/Work/Cortex/cortex/supabase/functions/delete-user-data/index.ts:104), [patient deletion](E:/Work/Cortex/cortex/src/pages/PatientManagement.tsx:90).

Account deletion never removes objects from the prescriptions bucket. Individual patient deletion removes database rows without removing patient files or prescriptions; cascades destroy their metadata references while the objects remain. Later account cleanup cannot discover earlier orphaned patient files through its metadata query. Account cleanup also ignores storage deletion errors and retrieves patient file references without pagination, yet reports that all data was permanently deleted.

Fix: use an idempotent deletion job covering every owner prefix, including prescriptions and orphans. Paginate listings, inspect each operation's returned error, keep job progress, and report completion only after verified cleanup. Test more than one API page, a storage failure, retry, and deletion after an earlier patient deletion. Retention obligations and backup deletion require a separate deployment/policy review.

### S7 P2 Spending limits race and fail open on accounting errors

Evidence: [quota reads](E:/Work/Cortex/cortex/supabase/functions/_shared/quota.ts:62), [check](E:/Work/Cortex/cortex/supabase/functions/_shared/quota.ts:100), [recording usage](E:/Work/Cortex/cortex/supabase/functions/_shared/quota.ts:118).

Concurrent requests can read the same remaining balance and all proceed before usage is recorded. There is no atomic reservation. Failed quota reads become default limit/zero usage, and `recordUsage` ignores Supabase's ordinary returned `{error}` result; its exception handler does not catch that result shape.

Fix: atomically reserve a budget in a restricted database RPC, settle actual usage, refund unused reservation, and use request idempotency. Handle accounting errors explicitly. Verify concurrent requests near the cap and a database outage.

### S8 P2 Knowledge extraction omits paid model usage

Evidence: [extraction](E:/Work/Cortex/cortex/supabase/functions/ingest-knowledge/index.ts:72), [recorded embedding estimate](E:/Work/Cortex/cortex/supabase/functions/ingest-knowledge/index.ts:115).

File extraction discards the model usage response. Only the later embedding estimate is charged. If extracted content is too short, the endpoint returns before recording any usage despite a paid extraction. Repeated unsuitable documents can consume model calls without advancing the counter.

Fix: record each extraction's actual usage immediately, independently of later validation/indexing outcomes, and include embedding usage in settlement.

### S9 P2 Clinical text can enter logs when AI parsing fails

Evidence: [raw model-response logging](E:/Work/Cortex/cortex/supabase/functions/process-clinical-notes/index.ts:123).

The parse failure log includes the first 300 characters of a response generated from clinical notes. Those characters may contain identifying and medical details. Fix: log request ID, response length, provider finish reason, and error classification; keep clinical payloads out of routine logs.

### S10 P2 Reminder email content is interpolated without HTML escaping

Evidence: [patient name interpolation](E:/Work/Cortex/cortex/supabase/functions/send-appointment-reminder/index.ts:146), [notes interpolation](E:/Work/Cortex/cortex/supabase/functions/send-appointment-reminder/index.ts:150).

Patient names and appointment notes can inject links, images, and layout into a Cortex-branded email. Email script blocking does not prevent this content injection. Combined with S3, a malicious user can target another tenant's patient.

Fix: escape all dynamic text or use an automatically escaping template engine. Test markup and URL payloads without sending external email.

### S11 P2 Exports omit data and treat failed reads as successful empty results

Evidence: [export implementation](E:/Work/Cortex/cortex/src/pages/DataPrivacy.tsx:27), [success notification](E:/Work/Cortex/cortex/src/pages/DataPrivacy.tsx:53).

The export contains only patients, consultations, and appointments. It omits file contents/metadata, prescription records/documents, templates, knowledge documents, and settings despite the broad export language. Returned query errors are never checked, and unpaginated results may be capped. A failed read can therefore produce an incomplete JSON file followed by an export-success message.

Fix: define the export scope precisely, fetch every page, include a manifest and downloadable documents where appropriate, and fail visibly or explicitly identify partial exports. Verify complete counts and representative document hashes before recommending deletion after export.

## Clinical integrity and recording findings

### C1 P1 Starting a new consultation retains another patient's briefing

Evidence: [new consultation activation](E:/Work/Cortex/cortex/src/pages/Index.tsx:184), [briefing rendering](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:1021).

Select A and load the briefing, then start a new consultation for B. This path changes `selectedPatient`, complaint, and chat but does not reset or fetch `preBriefing`. A's previous complaint, pending care, and alerts can be presented below B's name.

Fix: unify patient activation and bind briefing state/results to a patient ID. Test normal selection, new consultation, new patient creation, and out-of-order responses.

### C2 P1 Unsubmitted clinical notes follow the user into another chart

Evidence: [unkeyed draft state](E:/Work/Cortex/cortex/src/components/PatientSnapshot.tsx:50), [submission against current patient](E:/Work/Cortex/cortex/src/components/PatientSnapshot.tsx:99).

Browser-confirmed: type a synthetic note for A, start a consultation for B, and the note remains in B's active profile with Processar com IA enabled. Clicking it would submit A's note against B's patient ID. A late completion can also clear a newer draft because success unconditionally calls `setNotes('')`.

Fix: keep drafts per patient, bind each request/result to its originating patient and draft revision, and show an explicit decision before moving unsaved content. [Screenshot](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/wrong-patient-draft.png).

### C3 P1 Delayed replies and documents can appear under a different patient

Evidence: [chat completion](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:775), [comment completion](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:251), [document completion](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:941), [document preview patient binding](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:1578).

Ask a question or generate a document for A, then select B before completion. Several completion handlers append results into the currently displayed chat without checking the originating patient. Document state also survives patient changes, and printing uses the currently selected patient's name. A's document content can thus be displayed or printed with B's identity.

Fix: bind each operation and output to immutable user, patient, and consultation IDs. Preserve late results in the originating workspace or reject them; never relabel them from current selection. Extend the stale-response guard already used in consultation saving to every asynchronous path.

### C4 P1 Patient switching discards recordings and unresolved reviews

Evidence: [patient-change reset](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:181), [review result only accepted for active patient](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:706).

Changing patients immediately discards the recorder and clears review state without prior confirmation. If transcription finishes after the user leaves A and needs clarification, the review is simply not retained. There is no persistent pending consultation draft to reopen.

Fix: persist recording/processing/review jobs independently of the selected panel. Confirm before discarding active work and provide a resumable draft list. Test switching while recording, uploading, transcribing, reviewing, and finalizing, including mobile navigation.

### C5 P1 Source audio is removed before processing succeeds

Evidence: [early removal](E:/Work/Cortex/cortex/supabase/functions/transcribe-consultation/index.ts:135), [upload-only download fallback](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:669).

After upload to Gemini, the function immediately removes the Supabase recording, before transcription and SOAP generation succeed. A later provider error returns no consultation. The frontend only offers a local recording download when storage upload fails; it offers no equivalent recovery after transcription/draft failure. Gemini retaining an uploaded file does not provide a user-facing retry path here.

Fix: retain the durable source until processing and review drafts are persisted, expose retry/download on all failure paths, and clean it up according to an explicit retention policy. Test provider failure after a successful upload.

### C6 P1 Incomplete AI output can be automatically finalized

Evidence: [provider response handling](E:/Work/Cortex/cortex/supabase/functions/_shared/gemini.ts:46), [optimistic quality defaults and salvage](E:/Work/Cortex/cortex/supabase/functions/transcribe-consultation/index.ts:195), [automatic save](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:706).

The shared provider helper does not inspect finish reason or safety outcome. The draft parser defaults quality to `good`; invalid JSON is salvaged while clarification and alert arrays stay empty. The frontend interprets that combination as eligible for direct final saving. Empty, truncated, or malformed output can therefore become a final clinical record without review.

Fix: validate finish reason, response schema, required nonempty fields, and expected quality values. Treat any salvage or incomplete result as requiring review. Keep draft, reviewed, and finalized states distinct. Use deterministic provider stubs for empty candidates, safety blocks, MAX_TOKENS, invalid JSON, and absent fields.

### C7 P1 Accepted medication changes can retain the old dose

Evidence: [medication merge](E:/Work/Cortex/cortex/src/components/ProfileUpdateCard.tsx:46), [accepted-state message](E:/Work/Cortex/cortex/src/components/ProfileUpdateCard.tsx:87).

Medication merging discards an incoming object whenever its normalized name already exists. If an existing profile has a medication at 50 mg and the reviewed update changes it to 100 mg, acceptance leaves 50 mg while displaying a success message. Prescription defaults then inherit that obsolete profile dose.

Fix: present explicit dose/instruction/start-stop changes and require acceptance of the intended change. Merge by a stable medication identity and preserve unrelated metadata. Test dose changes, discontinuations, same-name formulations, and additions.

### C8 P1 Review regeneration drops the physician's recording-time corrections

Evidence: [comments sent to first draft](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:689), [review state](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:710), [review confirmation](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:877), [regeneration inputs](E:/Work/Cortex/cortex/supabase/functions/finalize-consultation/index.ts:146).

Recording-time comments inform the initial draft but are cleared on stop and omitted from review state. When clarification triggers regeneration, only the raw transcript and newly entered review comments are sent. Earlier physician corrections can disappear from the final note.

Fix: retain all original comments and the reviewed draft through finalization, with provenance and explicit precedence. Test an initial correction contradicted by the raw transcript and confirm it survives final regeneration.

### C9 P1 Prescription PDF rendering can overlap or leave the page

Evidence: [single A4 page](E:/Work/Cortex/cortex/supabase/functions/generate-prescription/index.ts:164), [medication layout](E:/Work/Cortex/cortex/supabase/functions/generate-prescription/index.ts:257), [fixed footer](E:/Work/Cortex/cortex/supabase/functions/generate-prescription/index.ts:267).

The PDF has one page, text advances down without page-break checks, and the footer starts at a fixed 168 pt. At the supported 15-medication limit, even short instruction lines enter the footer/QR area; longer instructions can go off-page. Name lines and exam names also lack measured-width wrapping.

Fix: paginate using measured font dimensions and reserve footer space on each page. Render and visually verify long names, accented text, long instructions, 15 medications, and 20 exams. This finding is established from layout geometry; a generated prescription PDF was not visually rendered during this review.

### C10 P1 Document generation silently drops selected medications or exams

Evidence: [medication cap](E:/Work/Cortex/cortex/supabase/functions/generate-prescription/index.ts:121), [exam cap](E:/Work/Cortex/cortex/supabase/functions/generate-prescription/index.ts:141), [composer submission](E:/Work/Cortex/cortex/src/components/DocumentComposerModal.tsx:174).

The backend slices medications to 15 and exams to 20. The composer accepts longer selections without a visible count limit or truncation warning. A successful document can therefore omit requested clinical content.

Fix: validate explicit limits at both boundaries and return an actionable error, or paginate the full selection. Never silently clip a clinical list. Test the exact boundary and one item above it.

### C11 P2 Concurrent comments and profile updates can overwrite each other

Evidence: [profile read](E:/Work/Cortex/cortex/supabase/functions/process-comment/index.ts:143), [read/merge/write mutation](E:/Work/Cortex/cortex/supabase/functions/process-comment/index.ts:271), [SOAP update](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:818).

Comment processing reads whole clinical arrays/text, waits for a model, and writes a merged snapshot. A second tab's intervening medication, allergy, or note can be lost. SOAP edits similarly replace text without a revision check. The local schema records update time but provides no clinical revision trail for recovering overwritten content.

Fix: perform atomic append/merge operations or use version-based optimistic concurrency. Preserve revisions and distinguish addenda from replacements. Test two concurrent writers and a stale editor.

## Functional findings

### F1 P1 User settings cannot be saved with the checked-in policies

Evidence: [settings RLS](E:/Work/Cortex/cortex/supabase/migrations/20260519000000_usage_quota.sql:26), [direct client upsert](E:/Work/Cortex/cortex/src/hooks/useUserSettings.ts:77).

Migrations allow authenticated users to read their settings, but only the service role may write. The hook nevertheless upserts specialty, live copilot, prescriber details, and active template from the browser. A database built from these migrations rejects those saves. This blocks prescriber onboarding and the workflows requiring completed prescriber data. A live database might have manual policy changes; that would be deployment drift requiring reconciliation.

Fix: expose a restricted settings RPC or carefully scoped column permissions. Keep `daily_credit_limit` server-controlled rather than granting unrestricted writes to the table. Surface save failures next to the affected control.

### F2 P2 Auth initialization and callback redirects race

Evidence: [callback early redirect](E:/Work/Cortex/cortex/src/pages/GoogleOAuthCallback.tsx:25), [conditional hook and render-time redirect](E:/Work/Cortex/cortex/src/pages/PatientManagement.tsx:35).

The Google callback interprets the initial `user=null` as unauthenticated while session restoration is pending, schedules a redirect, and never clears that timer if authentication later succeeds. Patient Management redirects during render and returns before a hook; an auth-state transition can change hook order. Several other secondary routes also lack a consistent loading/auth boundary.

Fix: use one protected route boundary that waits for auth initialization, keep hooks unconditional, and clean up callback timers/requests. Test a direct bookmarked route with slow session restoration, logout, and a successful callback after initialization.

### F3 P2 Consultation completion leaves cached history and status stale

Evidence: [limited invalidation](E:/Work/Cortex/cortex/src/components/ChatPanel.tsx:607), [backend changes](E:/Work/Cortex/cortex/supabase/functions/finalize-consultation/index.ts:206).

The backend always updates visit/status and attempts appointment completion. The frontend invalidates patients only when first-visit history was filled, and does not refresh consultation history or appointment caches. With focus refetch disabled, drawers and dashboards can continue displaying the previous clinical/scheduling state after a success message.

Fix: invalidate every affected query after each successful save/edit, or update those caches from a canonical mutation response. Test a subsequent consultation with history/dashboard already open.

### F4 P2 Date-only values and clinic-day boundaries are inconsistent

Evidence: [visit display](E:/Work/Cortex/cortex/src/pages/PatientManagement.tsx:256), [UTC-derived visit day](E:/Work/Cortex/cortex/supabase/functions/finalize-consultation/index.ts:208), [appointment-day matching](E:/Work/Cortex/cortex/supabase/functions/finalize-consultation/index.ts:214).

`new Date('2026-10-27').toLocaleDateString('pt-BR')` in America/Sao_Paulo displays **26/10/2026**. Date-only values are being interpreted as instants. Separately, finalization derives the day with UTC `toISOString`, so an evening consultation in Brazil can use the next clinic date and complete appointments in an unintended interval.

Fix: distinguish calendar dates from timestamps, format date-only fields without UTC conversion, and compute explicit timezone-aware clinic-day intervals. Test local midnight, 21:00–23:59 in São Paulo, and date-only round trips.

### F5 P2 WhatsApp reminder links and sent status are unreliable

Evidence: [unconditional country code](E:/Work/Cortex/cortex/supabase/functions/send-appointment-reminder/index.ts:102), [premature sent flag](E:/Work/Cortex/cortex/supabase/functions/send-appointment-reminder/index.ts:104).

A stored/imported phone beginning `+55` becomes a `5555…` number because the endpoint always prepends 55. It also marks the reminder sent when generating a link, before the user sends anything in WhatsApp. Closing the window, a blocked popup, or cancelling can remove a reminder from the pending list without delivery.

Fix: share one E.164 normalization helper and distinguish generated/opened/confirmed-sent states. Test local and international formats, a blocked window, and cancellation.

### F6 P2 Sign-up does not explain email confirmation requirements

Evidence: [sign-up success navigation](E:/Work/Cortex/cortex/src/pages/Auth.tsx:44), [wrapper discards session result](E:/Work/Cortex/cortex/src/contexts/AuthContext.tsx:49).

If the deployed Supabase project requires email confirmation, successful sign-up has no session. The UI navigates home and then back to login without a confirmation/resend explanation. This is conditional on deployed auth settings.

Fix: preserve the returned session/confirmation state and display a clear confirmation-required screen, with resend and recovery behavior. The authentication UI also has no password-reset flow; complete that lifecycle before broader onboarding.

## UI and accessibility findings

The interface has consistent brand colors, reusable Radix primitives, mobile patient cards, and a useful dashboard. Its largest UX problems concern completing and recovering clinical tasks, rather than visual styling. Review criteria included the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

### U1 P2 Tablet calendar header overflows

Evidence: [header composition](E:/Work/Cortex/cortex/src/pages/Calendar.tsx:228), [desktop-only legend threshold](E:/Work/Cortex/cortex/src/pages/Calendar.tsx:241).

Browser-confirmed at 820 × 900: document scroll width was **880 px** for an **820 px** viewport. The date wraps into a narrow vertical column and the primary appointment action extends beyond the right edge. The legend and all desktop controls activate together at 768 px without enough room.

Fix: let the toolbar wrap into deliberate rows, move the legend/status into a secondary row/menu, and use a compact header through the tablet breakpoint. [Screenshot](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/calendar-tablet.png).

The suspected absence of calendar navigation was **not confirmed**: the lazy-loaded vendor stylesheet makes the toolbar visible in the tested instance, overriding the global hide rule. The visible duplicate view controls are a consistency issue; do not remove the vendor toolbar until equivalent period navigation exists.

### U2 P2 New consultation dialog clips its title and actions on short screens

Evidence: [dialog without height/overflow limits](E:/Work/Cortex/cortex/src/components/NewConsultationModal.tsx:62), [fixed centered primitive](E:/Work/Cortex/cortex/src/components/ui/dialog.tsx:36).

Browser-confirmed: the new-patient dialog was **616 px** tall at a **600 px** viewport with `overflow-y: visible`. At 390 × 480, the title and footer controls were outside the visible region; the Cancel click could not reach its off-screen target. A mobile keyboard can create a similarly reduced usable height.

Fix: cap the dialog to available viewport height, make the body scrollable, and keep actions reachable with safe-area/keyboard handling. [Screenshot](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/new-consultation-mobile.png).

### U3 P2 Mobile actions and several clinical controls lack accessible names

Evidence: [patient action labels hidden on mobile](E:/Work/Cortex/cortex/src/pages/PatientManagement.tsx:149), [calendar add button](E:/Work/Cortex/cortex/src/pages/Calendar.tsx:290), [knowledge add](E:/Work/Cortex/cortex/src/pages/KnowledgeBase.tsx:115), [template create](E:/Work/Cortex/cortex/src/pages/Templates.tsx:185), [medication controls](E:/Work/Cortex/cortex/src/components/DocumentComposerModal.tsx:336), [clarification inputs](E:/Work/Cortex/cortex/src/components/ConsultationReviewModal.tsx:201).

Below 640 px, primary buttons hide their only text and retain only unnamed icons. The mobile calendar's add button was unnamed in the accessibility tree. Prescription medication checkboxes/dose fields, several appointment controls, and clarification answers lack explicitly associated labels. In a repeated medication list this makes the selected drug and changed dose particularly difficult to identify.

Fix: add persistent accessible names, connect every label/control with IDs, and include medication/question context in repeated labels. Verify with a screen reader and keyboard, not only static checks.

### U4 P2 Password visibility and assistant messaging are inaccessible

Evidence: [password toggle](E:/Work/Cortex/cortex/src/pages/Auth.tsx:241), [assistant composer/log](E:/Work/Cortex/cortex/src/pages/Assistant.tsx:126).

Password eye buttons have `tabIndex=-1` and no action name. The assistant's Send icon has no accessible name, its follow-up composer lacks a label, and new replies are ordinary divs without an announced message log/status. Visual auto-scroll does not announce a response to a screen reader.

Fix: restore keyboard focus for the password toggle, expose Show/Hide state, label the composer/Send, and provide a polite message log and busy status. Respect reduced-motion preferences for auto-scroll and decorative animation.

### U5 P2 Empty states conceal failed clinical and scheduling reads

Evidence: [patient query and empty state](E:/Work/Cortex/cortex/src/pages/PatientManagement.tsx:37), [calendar query/render](E:/Work/Cortex/cortex/src/pages/Calendar.tsx:147), [profile reads ignoring errors](E:/Work/Cortex/cortex/src/components/PatientProfileDrawer.tsx:95).

Several pages default failed queries to empty arrays and render no-patients/no-appointments states without using `isError`. Profile queries suppress returned errors and show blank history. Users cannot distinguish a first visit or empty schedule from an unavailable clinical record.

Fix: display explicit load failures with retry, retain last successful data, and differentiate not-recorded from unavailable. Reuse the dashboard's appointment error/retry treatment. Test backend denial, offline access, and a transient failure after an earlier successful read.

### U6 P2 Home and arbitrary chart navigation are incomplete

Evidence: [logo navigation](E:/Work/Cortex/cortex/src/components/PatientSidebar.tsx:72), [dashboard visibility](E:/Work/Cortex/cortex/src/pages/Index.tsx:258), [directory actions](E:/Work/Cortex/cortex/src/pages/PatientManagement.tsx:239), [recent-patient subsets](E:/Work/Cortex/cortex/src/components/WelcomeDashboard.tsx:105).

Browser-confirmed: after selecting a patient on desktop, clicking Cortex navigates to the already active `/` route and leaves the patient selected; the dashboard never returns. The patient directory offers edit/delete but no chart-opening action. Older patients outside recent/return/appointment subsets can only be opened by starting a consultation, unnecessarily changing clinical status.

Fix: provide an explicit Home action that preserves or resolves active work, searchable patient navigation, and chart deep links independent of starting a consultation.

### U7 P2 Deletion and editor dismissal need recovery affordances

Evidence: [appointment delete](E:/Work/Cortex/cortex/src/components/AppointmentModal.tsx:246), [delete control](E:/Work/Cortex/cortex/src/components/AppointmentModal.tsx:490), [template editor closure](E:/Work/Cortex/cortex/src/pages/Templates.tsx:327).

One click on the appointment trash control deletes the appointment and may initiate Google event deletion; there is no confirmation or undo. Template edits disappear on Escape/outside-click because closing clears the editor without checking dirty state. Similar unsaved clinical work deserves stronger protection under C4.

Fix: use a named delete action with patient/date/time confirmation or a reliable undo mechanism. Preserve drafts or confirm discard for dirty editors.

### U8 P2 Google Calendar connection disappears on mobile

Evidence: [all integration controls hidden](E:/Work/Cortex/cortex/src/pages/Calendar.tsx:271).

Browser-confirmed at 390 px: checking, connected status, and Connect Google all use `hidden sm:flex`; there is no compact alternative. Mobile users cannot initiate the connection or inspect its state from this page.

Fix: provide a named compact action or an integrations settings screen available at every breakpoint. [Mobile screenshot](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/calendar-mobile.png).

Additional P3 polish: decorative loops have no reduced-motion treatment; some dialogs emit missing-description warnings; loading/error copy and focus treatment are inconsistent. Address these after task-completion/accessibility blockers. A full WCAG conformance assessment, contrast sweep, and screen-reader session remain separate verification work.

## Engineering and operational findings

### E1 P1 Build success masks a broken type contract

Evidence: [build script](E:/Work/Cortex/cortex/package.json:8), [generated Supabase schema](E:/Work/Cortex/cortex/src/integrations/supabase/types.ts:1), [permissive TypeScript configuration](E:/Work/Cortex/cortex/tsconfig.app.json:21).

The build only runs Vite, so it emits output despite 54 TypeScript diagnostics. The generated database schema still describes four tables and lacks settings, files, prescriptions, templates, knowledge tables and new RPCs. Other failures include an invalid patient status assignment and a rendering type mismatch. These errors remove confidence that frontend queries/mutations match the backend.

Fix: regenerate types from the migration-backed schema, correct the remaining contracts, and run type checking before bundling. Tighten compiler options incrementally after the baseline is clean. See [full diagnostics](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/typecheck.txt).

### E2 P1 Test and automation coverage does not protect clinical behavior

Evidence: [auth tests](E:/Work/Cortex/cortex/src/pages/Auth.test.tsx:1), [mapper tests](E:/Work/Cortex/cortex/src/lib/patientMapper.test.ts:1), [test/build scripts](E:/Work/Cortex/cortex/package.json:6).

All eight tests concern login rendering or field mapping. There are no checked-in tests for two-user authorization, patient switching, recording failure recovery, clinical reconciliation, document boundaries, OAuth transactions, deletion, or quota concurrency. No `.github` workflow is present. The default worker mode also timed out in this environment, although a single-worker run passed.

Fix: add the release-critical regression suite listed below and a reproducible CI job for lint, type checking, tests, a clean migration bootstrap, and production build. Make test worker configuration suitable for CI; investigate the default-worker timeout without treating it as an application assertion failure. Do not use the current imported-module coverage percentage as a release-quality score.

### E3 P2 Dependencies need advisory triage and reproducible server imports

Evidence: [package manifest](E:/Work/Cortex/cortex/package.json:1), [audit results](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/npm-audit.json), [production subset](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/npm-audit-production.json).

The registry reports 29 affected package entries, including installed React Router 6.30.1, Vite 5.4.19, Zod 3.25.76, and transitive packages. All entries report a fix path, but some proposed fixes require a major migration. Advisory severity and production dependency classification alone do not establish exploitability in this browser-only deployment. Several affected packages concern tooling or code paths this app may not call.

Fix: triage reachable APIs and deployment exposure, update compatible patches first, and plan major migrations explicitly. Re-run both audits and targeted regression checks. Pin Edge function dependencies instead of importing floating major versions, and standardize one package manager/lockfile; the repository currently includes both npm and Bun locks.

### E4 P2 Network, scale, and diagnostics need explicit budgets

Evidence: [provider fetch](E:/Work/Cortex/cortex/supabase/functions/_shared/gemini.ts:35), [calendar all-record query](E:/Work/Cortex/cortex/src/pages/Calendar.tsx:153), [patients all-record query](E:/Work/Cortex/cortex/src/pages/Index.tsx:49), [eager workspace imports](E:/Work/Cortex/cortex/src/App.tsx:11).

Provider fetches have no explicit application deadline or cancellation. A hung call can leave a long user wait until platform/network termination. Patient, appointment, history, and export paths commonly fetch all records without explicit pagination; large datasets may exceed response limits or overload rendering. The main bundle is large because the authenticated workspace is eager even for the login route. No root React error boundary or structured client error-reporting path appears in the reviewed source.

Fix: give operations deadlines and retry/idempotency rules, retain jobs for recovery, paginate/time-bound list queries, and lazy-load the authenticated workspace/heavy composers. Add a recoverable error boundary and redacted request-ID diagnostics. Measure production LCP/INP, slow-network behavior, large datasets, and provider tail latency before claiming a performance improvement.

Repository deployment configuration contains SPA rewrites but no explicit CSP/frame/referrer/nosniff policy. Verify the actual host response headers and configure a policy appropriate to the app's inline styles/printing and storage/model connections. Host-provided HSTS or other defaults were not inferred from the local config. Wildcard CORS alone was not classified as an authentication bypass.

## Controls that already help

- Ordinary protected endpoints validate identity with `auth.getUser()`; most privileged patient queries explicitly scope `user_id`.
- A later integration migration removes browser access to raw Google OAuth token columns.
- Private storage buckets, cryptographically random prescription codes, read-only built-in templates, and tenant-filtered knowledge retrieval are useful foundations.
- Usage-counter mutation is restricted to the service role; the remaining problem is reservation/error handling around it.
- React output escaping and the shared print HTML escaping reduce ordinary markup injection risk in those paths.
- Consultation saving already rejects stale patient chat completion in one path; extend that pattern to all jobs.
- Audio upload has retry/backoff and an upload-failure download fallback.
- Radix dialog primitives, mobile bottom navigation/cards, several explicit accessible names, and the dashboard's appointment error/retry state provide patterns worth retaining.
- Secondary routes are lazy-loaded and the production build succeeds.

These controls do not close the specific bypasses and data-integrity failures above, but they support focused repairs rather than a wholesale rewrite.

## Recommended repair order

1. **Close privileged access paths.** Restrict prescription writes, canonicalize/authorize every service-role storage read, enforce related-record ownership, and bind OAuth transactions. Add negative tests before releasing the fixes.
2. **Protect clinical work.** Isolate every draft/job/result by patient and consultation; retain recordings and review drafts; reject incomplete AI results; preserve physician corrections and reconcile medication changes explicitly.
3. **Make documents and privacy actions reliable.** Paginate PDFs, reject silent truncation, implement verified storage cleanup, and export complete, checked data before deletion.
4. **Restore trustworthy functionality.** Fix settings policies using a narrow write surface, auth initialization, date handling, cache invalidation, concurrent edits, and reminder semantics.
5. **Complete core usability.** Fix tablet/mobile overflow, accessible labels, errors versus empty states, chart search/opening, Home, dirty editors, and mobile integrations.
6. **Establish release gates.** Regenerate database types, resolve lint/type errors, add CI and the clinical/security suite, triage dependencies, then measure performance and operational behavior.

Suggested implementation boundaries: a shared authorization/storage layer; a patient/consultation workspace with durable jobs; a document layout module; and a verified privacy export/deletion service. Keep each repair independently reviewable and covered by an actual behavioral regression test.

## Regression and release verification

| Suite | Required scenarios |
| --- | --- |
| Tenant isolation | Two users; foreign patient IDs in every relationship; leading-slash/dot/encoded/cross-bucket storage paths; direct lifecycle-field mutation; unknown object path response |
| OAuth | Wrong/missing/replayed/expired state, code from another transaction, session restoration delay, callback retry, wrong redirect origin |
| Patient workspaces | Switch A to B during draft entry, chat, comment, document generation, recording, upload, transcription, review, final save; no content relabeling or silent loss |
| Clinical reconciliation | Same-name dose/instruction changes, discontinued medications, concurrent allergy/note changes, retained physician corrections, cache refresh after later visits |
| Provider failures | Empty candidates, safety block, truncation, malformed schema, timeout, provider error after upload, accounting failure, safe retry without duplicate consultation |
| Documents | Maximum and over-limit lists, long names/instructions, Unicode, multiple pages, footer/QR visibility, independent signature/validity status |
| Privacy | More than one result page, previously orphaned objects, prescription objects, storage errors, interrupted/retried deletion, export completeness before account removal |
| Calendar and reminders | Local-day boundaries, date-only round trips, blocked/cancelled WhatsApp, normalized phones, deletion confirmation, mobile integration access |
| Accessibility and layout | Keyboard-only forms, screen-reader medication labels and chat announcements, 390/768/820/1280 px, short screens, keyboard shown, 200% zoom, reduced motion |
| Scale and operations | Large patient/history/appointment lists, response caps, concurrency at quota boundary, redacted logs, recovery UI for chunk/render failure |

Deployment verification still needs a disposable Supabase environment bootstrapped from these migrations, two test identities, provider stubs/test accounts, real production response headers, and inspection of actual policies/secrets/integration settings. Backups and restore drills, retention obligations, clinical quality evaluation, and independent legal/regulatory review cannot be established by this source audit. No compliance certification or exhaustive penetration-test claim is made.

## Evidence files

- [Full dependency audit](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/npm-audit.json) and [production dependency audit](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/npm-audit-production.json). Advisory URLs are included with each registry result.
- [TypeScript diagnostics](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/typecheck.txt).
- [Coverage summary](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/coverage-summary.json), limited to modules instrumented by the existing tests.
- [Offline storage reproduction](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/offline-storage-repro.mjs). Run from this repository with `node docs/reviews/2026-10-27/offline-storage-repro.mjs`; every fetch is intercepted.
- [Wrong-patient draft screenshot](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/wrong-patient-draft.png), [tablet calendar](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/calendar-tablet.png), [mobile calendar](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/calendar-mobile.png), and [short-screen dialog](E:/Work/Cortex/cortex/docs/reviews/2026-10-27/new-consultation-mobile.png). All patient content is synthetic.
