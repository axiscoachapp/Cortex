# Haddad Nicola implementation

2026-10-28. Local implementation of APP_REVIEW.md and its app improvement map. The clinic scope is individual doctor accounts, private patient lists and explicit patient sharing. API-provider selection, PersonalMed migration and production deployment remain separate, as requested.

**AI is disabled by default.** `AI_ENABLED=true` is required at admission and provider boundaries. Manual documentation, reviewed structured records, scheduling and access controls remain usable without AI. This contains the provider-related release gate; it does not establish permission to use the existing vendor for clinical work.

## Review disposition

| Review references | Implemented behavior |
|---|---|
| SEC-01 | Provider kill switch defaults off; manual encounter path requires no model or AI quota. Provider decision remains deferred. |
| SEC-02 | Server-owned, idempotent discard removes audio before metadata, retains failed obligations and blocks late writes/uploads. Historical orphan inventory and operator reconciliation are documented separately. |
| SEC-03, W3 | Document/history extraction creates persisted, source-linked proposals. Exact physician-edited acceptance/rejection uses revision checks and receipts. Review displays approved note, original transcript or source document; unseen history is never silently promoted. |
| SEC-04 | Reusable AI templates accept closed specialty structures instead of patient examples. Generated text enters an editable review before activation. |
| SEC-05 | Deadlines include bounded response-body consumption and cancellation, including streams that stall after headers. |
| SEC-06 | Issuance stores immutable issuer/content/patient snapshots. Later profile settings cannot rewrite a historical verification manifest. |
| SEC-07 | Known provider files have cleanup/retry obligations. Interrupted uploads with unknown results retain unresolved leases. Receipts distinguish unresolved external state, logs and backups. |
| SEC-08 | Durable owner-bound export manifests use a stable SQL snapshot, object-version checks, final conflict validation and file hashes. Supported browsers write incrementally to disk; fallback retains its documented aggregate limit. |
| SEC-09 | Frontend/build configuration is explicit and validated. No real backend fallback; secret/service keys are rejected in browser configuration. CI uses an isolated fixture. |
| W1 | Unknown age/last visit remain null; newborn zero is preserved. Optional DOB derives encounter-date age using São Paulo dates in frontend, clinical server reads, PDF and issuance snapshot. |
| W2 | A persisted optional appointment ID binds one encounter to one appointment. Unscheduled encounters complete none. Metadata completion is atomic and identical retries repair pending completion. |
| W4 | Question-aware retrieval can find older records. Answers expose excerpts, IDs, dates and bounded coverage; absence from retrieved context is not absence from the chart. Protocol citations preserve source/version/reference/reviewer metadata. |
| W5 | Certificate duration is validated exactly in UI/API; invalid values require correction instead of silent clamping. |
| W6 | Registration, CSV registration and scheduling no longer invent completed-visit dates. Completion uses clinic dates and preserves newer recorded visits. |
| W7 | Google sync persists creation identity and pending/failed/synced state; leases serialize retries and raced edits remain pending. Lost provider responses reconcile the same event. |
| UX-01 | Patient selection updates the authoritative URL; refresh stays on the selected patient. Reselecting the active patient preserves mounted capture. |
| UX-02 | Directory demographics use revision-aware updates and checked returned rows; conflicts/deleted rows retain the editor. |
| UX-03 | One route blocker coordinates editor registrations. Back, route changes, reload and close respect unsaved work; capture/in-flight acceptance blocks exit. |
| UX-04 | Ordinary reminders require a future scheduled/confirmed appointment in UI and server. WhatsApp preparation remains distinct from delivery. |
| UX-05 | Lookup failures, loading and empty states are distinct and retryable. |
| UX-06/07 | Readable semantic colors, textual statuses, selected-mode/view semantics and keyboard focus. The rendered primary button measured 6.05:1 text contrast. |
| UX-08 | Patient-linked capture timer/actions remain visible across local tabs. Session recheck failures hide clinical UI while preserving the mounted capture tree. |
| UX-09 | Localized/named close controls, document descriptions and recoverable clipboard/blocked-print failures. |
| UX-10 | The full three-panel workspace begins at desktop width. Tablet/mobile navigation exposes each panel without compressing the composer; additional manual-work/calendar wrapping issues found during verification were repaired. |

## App improvements

- **Doctor and patient access:** clinic invitations/activation/offboarding, explicit read/contribute/download grants, private lists, attributed immutable contributions and audit history. Membership/admin status alone grants no patient access. Revocation checks protect delayed work and authenticated file streaming. Custody guards prevent ordinary deletion from erasing retained shared records.
- **Reviewed protocol sharing:** separate, read-only grants to exact approved source versions. Patient sharing grants no protocol access. Retirement, offboarding and revocation invalidate access; successor versions start private. RAG rechecks captured grant/review revisions before model use and delivery. Cached answers are revalidated, hidden on uncertain/revoked access, and excluded from automatic subsequent chat history.
- **Manual consultation:** autosaved physician-authored draft, editable final text, explicit atomic confirmation without AI, recovery queue and exact appointment binding. Final records cannot be downgraded and edited as drafts.
- **Clinical continuity:** consultation timeline/revision comparison, versioned observations, confirmed pregnancy episodes/dating provenance, previsit intake and result/referral/follow-up tasks with due dates. Pending lists identify the patient and next action.
- **Medication lifecycle:** explicit reconciliation compares the active list and uses both patient/item revisions. Dose changes preserve unrelated medications; suspension removes the drug from the active list while retaining immutable lifecycle history.
- **Documents:** approved patient instructions retain linked versions. Printing/downloading does not claim patient delivery. Verified electronic-signature integration remains conditional on the later API discussion.
- **Scheduling follow-through:** manual waitlist preferences and contact/confirmation stages are versioned follow-up records. They do not send messages or book slots automatically. The calendar opens near the working day and links to pending work.
- **Knowledge:** original text, bibliographic reference, version, reviewer/date, approval, retirement and indexing retries. Patient attachments cannot be ingested as reusable knowledge sources. Retrieval uses approved ready sources and compatible embedding versions.
- **Engineering:** bounded summary directory with exact counts; today's appointment contact lookups work beyond the first directory page. Full clinical detail is fetched for the selected patient. Types are generated from all migrations. Public app/entrypoint/brand readiness checks run in CI. Provider-operation IDs and static latency/outcome logging exclude PHI; atomic admission is separate from monetary quota.
- **Session protection:** optional TOTP enrollment/verification; enrolled users require `aal2` at UI, direct clinical RLS/Storage, authenticated RPC and Edge boundaries. This does not claim that enrollment has been configured for real clinic accounts.

Broad billing/TISS replacement, a patient portal and autonomous clinical decisions remain outside the clinic launch scope established in the review. PersonalMed source inspection/import/cutover has not been performed.

## Brand and browser evidence

The official clinic logo/favicon, gold, charcoal and cream palette, Montserrat and Source Serif typography are applied to the app. Fonts are local assets with their license notices. Ornamental logo gold is retained; darker ochre gives readable controls. Unsupported speed/compliance/hosting promises were replaced with actual behavior.

Synthetic browser checks covered desktop 1280px, tablet 820px, calendar 768px and mobile 390px, navigation, manual save/reload recovery, sign-out, keyboard focus and sharing controls/empty states. The consultation input measured **610px at 820px** (previously 66px) and **188px at 390px**. No horizontal overflow remained in the inspected mobile workspace/auth screens. Bounded browser console inspection returned no errors/warnings.

Screenshots: [desktop](desktop-1280.png), [tablet](tablet-820.png), [mobile](mobile-390.png), [manual draft](manual-draft-820.png), [reload recovery](draft-recovery.png), [mobile manual work](manual-mobile-390.png), [calendar](calendar-768.png), [sharing](sharing-1280.png), [sign-in](auth-desktop.png). Metrics are in [browser-metrics.json](browser-metrics.json).

## Verification

Final combined results are recorded in `validation.json` and the `*-final.txt` logs in this folder. Targeted regression checks ran after each repair; independent reviews found and repaired capture, replay, revocation, custody, in-flight editing and metadata-completion defects. The earlier ordinary full run passed 274 tests before the final protocol/cache additions. Earlier failing runs remain as evidence of fixture/contract changes; they are not counted as successful checks.

Final checks passed: **289 tests in 51 files with completed coverage**, **39 migrations and 18 SQL suites**, **24 Edge Function checks**, app/Node TypeScript and production build, lint with zero errors/eight existing Fast Refresh warnings, and zero reported npm vulnerabilities. Line coverage is **45.08%**; it is not a claim of complete behavioral or clinical verification.

The final build uses an explicit `.invalid` backend fixture for verification; deployments need their own correct environment. No production credentials, real patient records, microphones, provider calls, external messages, signatures or PersonalMed exports were used. The user chose local verification and skipped an external cross-model CLI review.

## Operational limits and next release steps

Read [RUNBOOK.md](RUNBOOK.md) and [PRIVACY_AND_OPERATIONS.md](PRIVACY_AND_OPERATIONS.md). Hosted Auth/Storage/MFA/OAuth/email, large archives and database-plus-file restore require staging evidence. No hosted alerting service or backup policy was configured by local code changes. Legacy orphan audio and unknown provider uploads require exact operator reconciliation; the code does not infer that external bytes vanished.

Copied/downloaded content cannot be recalled. UI authorization checks have explicit refresh/deadline behavior; they are not a claim of instantaneous recall across a network. Shared clinical custody can block ordinary account/patient deletion and needs a governed clinic procedure.

The next discussions remain the requested AI-provider/use-case decision and later PersonalMed migration. Keep AI disabled until that decision and its evaluation are complete.
