# Security, privacy, backend and operations reassessment

Reviewed 2026-10-28 against local commit `1ad2116`, branch `codex/app-audit-remediation`. This is a read-only source reassessment with one synthetic timeout reproduction. Application code was not changed; production, paid model services and real patient records were not accessed. The previous remediation evidence remains useful but does not establish production readiness.

The confirmed rollout is all clinic doctors with **separate patient lists and explicit optional sharing**. Current `user_id` ownership is a useful default to preserve. Existing PersonalMed 2005 exports may support a later migration; no migration was performed in this review. Reception access is outside the current launch scope.

## Principal conclusion

The existing repairs substantially improve identity, object-path authorization, concurrent clinical writes, source-audio recovery, prescription lifecycle integrity and cost admission. They do not yet justify a real-patient launch. The current Gemini API terms are a deployment gate; there are also residual data-lifecycle and physician-review defects. Optional sharing additionally requires explicit grants, per-author records, consistent revocation and auditability; it must not make all clinic records visible to all doctors.

## Confirmed findings and release decisions

### SEC-01 — P0 launch gate: the configured AI service has a clinical-use restriction

**Evidence:** `supabase/functions/_shared/gemini.ts:7,47` calls the Gemini Developer API at `generativelanguage.googleapis.com`; transcription/document analysis and clinical assistants share this helper. The live [Gemini API terms](https://ai.google.dev/gemini-api/terms), effective March 23, 2026, prohibit use in clinical practice and medical advice. Paid-service data handling differs from unpaid usage, but the clinical-use restriction is in the general use restrictions. Unpaid services additionally prohibit sensitive/confidential/personal submissions.

**Impact:** the intended clinical workflow cannot be treated as eligible for launch merely by enabling billing, receiving patient consent or adding a disclaimer. No alternative service is assumed eligible by its brand name.

**Next step:** resolve the provider/product/contract and permitted intended use with the provider and accountable clinic owner, then document data handling, region, retention and contractual terms. Keep real-patient AI disabled until that decision is evidenced. Introduce a provider adapter and feature gate so manual workflows remain usable without the AI provider.

**Acceptance:** an approved provider decision is recorded; the configured deployment uses that specific eligible product; prohibited/unconfigured provider modes fail closed; synthetic provider-contract tests cover every clinical call site. Clinical evaluation must then be repeated against the chosen model.

### SEC-02 — P1: discarded draft audio can survive patient deletion

**Evidence:** `src/components/ChatPanel.tsx:772–777` deletes the `consultation_drafts` row before deleting its Storage object, ignores the returned Storage error and hides recovery. `supabase/functions/delete-patient/index.ts:48–59` finds audio only through existing draft metadata. The object key is `consultations/<user>/<file>`, not a patient prefix.

**Reproduction condition:** discard a saved draft; let its database deletion succeed and its Storage removal fail. Later delete that patient. The patient endpoint cannot locate that orphaned audio. Account-wide prefix cleanup would still find it, but individual-patient deletion does not.

**Impact:** the UI confirms a destructive action while identifiable audio remains, and subsequent patient deletion can report success without removing it.

**Repair:** server-owned idempotent discard operation; retain a patient-linked cleanup record until Storage confirms deletion. Reconcile existing orphans with preserved historical metadata rather than guessing their patient. Ensure all audio cleanup paths use the same operation.

**Acceptance:** inject Storage failure after successful metadata lookup; draft/cleanup identity remains visible and retryable. Race discard with patient deletion; final success requires removal of all patient-linked objects. Verify through actual Supabase Storage HTTP, not only a mocked client.

### SEC-03 — P1: attachment analysis writes model claims into the chart without acceptance

**Evidence:** `src/components/ChatPanel.tsx:521–548` automatically invokes analysis after attachment. `supabase/functions/analyze-document/index.ts:146–162` validates only the model output shape and immediately calls `save_document_review`. `supabase/migrations/20261028000400_atomic_document_review.sql:12–16` updates `ai_summary` and appends `profile_note` to `patients.clinical_notes`. There is no intermediate clinician accept/reject operation. `chat-assistant/index.ts:149` subsequently labels clinical notes as physician notes, and `:168–179` consumes attached-document summaries.

**Reproduction condition:** a schema-valid model response misreads a laboratory value or follows instructions embedded in an attachment. The derived claim enters persistent chart context as soon as analysis succeeds.

**Impact:** schema validity and an atomic write do not establish clinical truth. An unreviewed extraction can influence later assistance and briefings.

**Repair:** persist an explicitly unreviewed extraction separately; present the original document beside proposed facts; require clinician accept/edit/reject before promotion to authoritative chart context. Record source, reviewer, model/version and acceptance time. Keep unreviewed content out of ordinary chart facts and clearly label it if shown to an assistant.

**Acceptance:** malformed and schema-valid-but-wrong output never mutates clinical facts before acceptance; rejected output remains out of context; accepted output retains provenance; retry is idempotent and concurrent acceptance cannot duplicate notes.

### SEC-04 — P1: reusable templates trust prompt-only removal of patient identifiers

**Evidence:** `create-template-ai/index.ts:49–58` asks the model to replace patient data; `:120–126` checks shape and nonempty content, not deidentification. `src/pages/Templates.tsx:107–124` immediately inserts the returned template. The example-mode copy promises that the AI will remove patient data.

**Reproduction condition:** a synthetic model response retains a patient's name, document number or a distinctive clinical detail in valid template content. The current client saves it without a review step. Later reuse can place those details into another patient's generated document.

**Impact:** cross-patient contamination and misleading privacy assurance within the same clinician account. This review does **not** claim a cross-account access-control exploit or that an actual patient leak occurred.

**Repair:** generate into an editable draft; show identifier warnings and source/output comparison; require explicit approval before activation; revise automatic deidentification claims. Detection helps review but is not a guarantee. Prefer synthetic examples and structured placeholders, and keep versions so unsafe templates can be retired.

**Acceptance:** synthetic names, CPF-like values, dates, addresses and uncommon identifiers cannot silently become active reusable content; explicit review is required; output provenance and a prior version are retained.

### SEC-05 — P2: the provider deadline excludes response-body consumption

**Evidence:** `supabase/functions/_shared/http.ts:28–35` clears its timer immediately when `fetch` returns headers. Callers then consume the body separately, e.g. `gemini.ts:57` and `:128`. Most service-role database/storage clients are also created without a deadline-aware fetch.

**Synthetic reproduction run in this review:** transpiled the actual `http.ts` helper, supplied a synthetic fetch that returns headers immediately and never closes its response stream, and called `fetchWithDeadline(..., 20)`. After 100 ms, `response.text()` was still pending and `signal.aborted` was false. No network service was called.

**Impact:** a slow or stalled body can occupy the request until the platform kills it, leaving the UI waiting and cost/draft states unresolved despite the apparent 90-second deadline.

**Repair:** an operation-scoped deadline must cover headers, bounded body reading and cancellation; classify timeout errors consistently. Use deadline-aware database/storage clients where supported and resumable jobs for legitimately long work.

**Acceptance:** header stall, body stall, oversized streamed body and caller cancellation all terminate in a bounded time; retained clinical drafts remain recoverable and unknown provider cost is not incorrectly refunded.

### SEC-06 — P2: prescription validation reports the current settings identity, not the issuance identity

**Evidence:** `validate-prescription/index.ts:84–107` reads the current `user_settings` doctor name and CRM for the validation manifest. `generate-prescription/index.ts:302–314` stores no immutable prescriber snapshot beside the document. The PDF itself is generated with settings at issuance.

**Reproduction condition:** generate a document with one name/CRM, then legitimately correct settings. The same validation URL now emits the new prescriber metadata for the original PDF.

**Impact:** validation metadata and immutable document content can disagree; this is particularly problematic before clinic roles or multiple prescribers are introduced.

**Repair:** store a server-owned issuance snapshot of prescriber identity, patient identity as printed, document content hash and template/version. Validate against that snapshot; corrections produce a new issuance or explicit amendment, not a mutated historical identity.

**Acceptance:** changing current settings cannot change an old document's manifest; newly issued documents use the new identity; existing documents without trustworthy snapshots are explicitly handled rather than backfilled from current settings.

### SEC-07 — P2: provider-hosted clinical files are not explicitly cleaned up

**Evidence:** `gemini.ts:85–131` uploads audio/documents and returns a file URI; neither the helper nor its analysis/transcription callers delete the uploaded provider file or persist a cleanup obligation. Account/patient deletion only addresses the app's Supabase stores. The app says all files/data were removed permanently (`DataPrivacy.tsx:65,102,146`).

Google's [Files API documentation](https://ai.google.dev/gemini-api/docs/files) says uploaded files are automatically deleted after 48 hours and supports explicit deletion. This does not establish the retention of every other provider log or backup.

**Impact:** app deletion is not equivalent to immediate deletion of provider-hosted copies. The current wording is stronger than the implemented cross-provider lifecycle.

**Repair:** after resolving SEC-01, implement the selected provider's supported cleanup in `finally`, record failed cleanup for retry and include external processing status in a truthful deletion receipt. Publish the actual retention policy for source audio, derived notes, provider copies, operational logs and backups.

**Acceptance:** success, model rejection, parsing failure, timeout and deletion all attempt safe provider cleanup; retries use the exact stored provider file identity; receipts distinguish completed, queued and provider-retained categories.

### SEC-08 — P2: export is complete only for a quiescent account, not a consistent snapshot

**Evidence:** `export-user-data/index.ts:47–63` reads tables sequentially with offset ranges. File listing and download occur later, independently. No export snapshot, high-watermark or write fence is established. `DataPrivacy.tsx:44–45` reports every record/file included.

**Reproduction condition:** delete an earlier row after export page one while another browser is exporting page two; offset pagination shifts and skips a surviving row. Concurrent edits across patients/consultations can also make the exported relationships disagree. This is a source-derived concurrency case, not a reproduced production incident.

**Repair:** define export consistency explicitly. For migration/backup-quality exports, create a server-side snapshot/job with stable manifests, checksums and a supported file version/cutoff policy. Add resume and archive streaming; retain the existing explicit browser limit until replaced.

**Acceptance:** concurrent insert/update/delete tests yield a consistent documented point-in-time result or explicit conflict/retry, never silent completeness; exports larger than 100 MB complete through the server job with size/hash verification.

### SEC-09 — P2: environment configuration silently falls back to a real Supabase project

**Evidence:** `src/integrations/supabase/client.ts:5–6` supplies a real project URL/public anon key when either build variable is absent. The public key is not a secret; the defect is implicit environment selection.

**Impact:** a developer, preview or misconfigured deployment can unexpectedly target the existing project. RLS still applies, but logged-in test actions may affect real records if that project is production.

**Repair:** explicit environment validation; production builds require matching URL/key configuration, while local/demo mode uses a deliberately chosen isolated backend. Show an environment indicator for nonproduction builds.

**Acceptance:** missing/mismatched variables fail startup/build without network calls; CI and preview never use fallback real-project credentials; the deployed project reference is checked before migrations.

## Clinic capabilities for private patient lists with optional sharing

These are missing product capabilities, not claims that existing single-user RLS is broken.

| Capability | Why it matters for separate doctors with optional sharing | Minimum acceptance |
|---|---|---|
| Separate physician identities and patient ownership | Current `user_id` isolation is the desired default; clinic affiliation must not imply chart access | Each doctor signs in separately; patient lists remain private; no shared passwords or automatic clinic-wide visibility |
| Explicit selected-doctor grants | Read-only and contribute access are different clinical responsibilities | Owner chooses a recipient and a permission; contribution creates an attributed record; no overwrite of another author's note, re-sharing, bulk export or deletion by default |
| Consistent revocation | A removed grant must also remove derived access | Tests cover SQL, Edge, Storage URLs/downloads, search/retrieval, AI context, cached briefings and active sessions; short-lived URLs have a defined residual validity policy |
| Offboarding while retaining historical authorship | Current account deletion cascades user-owned medical records; that cannot be reused blindly as a staff removal action | Remove access and revoke sessions separately from governed retention/deletion; historical notes keep their original author; clinic custody decisions are explicit |
| MFA, step-up verification and session controls | A persisted session currently authorizes all export/deletion operations | Recovery-tested enrollment; server/RLS enforcement; step-up for bulk export, role changes and deletion; idle-screen privacy with safe draft recovery |
| Read/download/export audit trail | Current immutable clinical snapshots document edits, not who viewed/exported patient data or why | Actor, organization, resource ID, action, result and timestamp without unnecessary PHI; restricted audit access and defined retention |
| Consent and processing provenance | Recording, documents, external AI and communications have different purposes and disclosure needs | Versioned notice/authorization records where applicable; visible recording state; manual path when AI/recording is unavailable; no claim that consent overrides provider restrictions |
| Asynchronous lifecycle jobs | Export/deletion/cleanup can exceed one Edge request and must survive browser closure | Durable operation ID, progress, retry, partial-failure status and operator recovery; idempotent commands |
| Integration and service health | Static error labels avoid PHI leakage but do not explain outages or costly failures | Correlation IDs, operation types, latency/error metrics, provider/model version, quota status and actionable alerts without transcripts or patient names |
| Backup and restore drills | Database and private objects must restore together, including versions and relationships | Isolated restore with integrity/row/object counts; measured recovery objectives; test removal of an ex-staff account after restore |

Supabase's [MFA guide](https://supabase.com/docs/guides/auth/auth-mfa) explicitly requires enforcement beyond the enrollment UI. Its [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) also calls for security configuration review, staging load testing and recovery planning. Those controls cannot be inferred from this source checkout.

## Remaining deployment evidence

- Rehearse the existing 26 migrations and new work on an isolated Supabase project with real Auth/Storage HTTP. The prior disposable PostgreSQL bootstrap validates SQL/RLS logic but is not the native Storage service.
- Re-test stale JWTs, deletion/upload races, failed cleanup, callback expiry/replay, email recovery, Google refresh/revoke and provider failures with designated synthetic accounts.
- Inspect deployed headers/CSP, exact origins, allowed redirects, rate limits, email delivery configuration, project access, backup policies and alerts. Their production values were not read here.
- Add API rate/abuse control to sensitive and public expensive paths as needed after measurement. The existing daily AI credits are not a substitute for request-rate or export/deletion concurrency controls.
- Keep physician approval and source provenance in the clinical evaluation plan. Schema-valid output and passing unit tests do not establish clinical correctness, medication safety or regulatory clearance.

## Suggested delivery order

1. Resolve AI provider eligibility and intended use; keep real-patient AI gated.
2. Repair SEC-02–04 and establish a common source/acceptance model; repair operation deadlines and immutable issuance metadata.
3. Preserve the confirmed private-per-doctor access model. Build explicit selected-doctor read/contribute grants and revocation before enabling optional sharing; do not turn clinic membership into blanket patient access. Design and validate the PersonalMed import as a separate later project.
4. Add session protection, access audit, provider cleanup and consent/retention policy.
5. Add durable export/deletion jobs, integration health and restore rehearsal; validate deployment with synthetic data.
6. Only then expand specialty assistants, shared templates, patient messaging or cross-system integrations. Each must inherit the permission and provenance contracts.

## Verification performed in this lane

- Source traces across Auth, service-role queries, OAuth, deletion/export, storage guards, quota/model helpers, prescription issuance/validation, templates, attachment analysis and migration privileges.
- Synthetic execution of the actual shared timeout helper proved the response-body gap.
- Current primary-source provider terms, file-retention documentation and Supabase production/MFA guidance were read on 2026-10-28.
- No live penetration test, provider request, user/session change, patient-data access or production deployment was performed. Full unit/build/database checks are coordinated by the main review agent.
