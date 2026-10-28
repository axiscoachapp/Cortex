# Privacy and operations changes

Local implementation, 2026-10-28. Provider selection, clinical model evaluation and PersonalMed migration remain deferred. No real provider requests, patient records or production changes were used in verification.

## Implemented contracts

- `discard-consultation {draftId}` marks the owned draft for discard transactionally, blocks late writes/uploads, removes its exact source audio, then deletes metadata. Failed removal preserves the patient-linked identity and supports retry. Direct client draft deletion is revoked.
- The shared fetch deadline covers headers and bounded body consumption, caller cancellation and stream-size limits. The default response limit is100MiB; source audio remains limited to25MiB by the transcription handler.
- Prescription issuance stores immutable prescriber/patient-as-printed metadata, issuance time, template version and PDF SHA-256. Public validation reads this snapshot. Legacy documents without trustworthy snapshots require reissuance; current settings are never used to invent historical identity.
- Provider uploads acquire a durable patient-linked lease before source bytes are sent. Successful upload converts it to an exact provider file cleanup obligation; generation/analysis cleanup runs in `finally`. Failed deletion retains the obligation, and patient/account deletion retries it before removing metadata.
- An interrupted source upload with an unknown result retains its lease. A random lease UUID appears in the provider upload display name for exact operator reconciliation. A timer does not prove the remote bytes disappeared. Deletion remains incomplete until the unresolved provider state is reconciled; operational logs and backups have separate retention policies.
- Export manifests are captured in one stable SQL snapshot, persisted under a one-hour access expiry and bound to the authenticated owner. File requests verify object versions before and after download; completion compares the current owned records/object manifest and returns conflict on concurrent change. Recipients cannot export another doctor's whole chart. Owned charts include attributed contributions and sharing audit.
- Native File System Access writes the JSON archive incrementally and commits only after final verification. The browser fallback retains its100MiB aggregate limit. This is a durable manifest with bounded per-file retrieval, not an unbounded hosted archive service. File bytes are hashed; no claim of a production-scale stress test is made.
- Patient deletion intent invalidates stored export copies atomically, and new exports are blocked during deletion. Account deletion cascades export snapshots. Expired snapshots are physically pruned on subsequent snapshot creation; deployments should also schedule a daily expiry purge if no further exports occur.
- Frontend startup and builds require explicit backend settings; JWT anonymous keys must match their Supabase project. Service-role/secret keys are rejected. Explicit loopback/`.invalid` fixtures are supported. No implicit real project is selected.

## Operation controls

`AI_ENABLED` must equal `true` in the Edge Function environment to enable generation, embeddings and file uploads. Missing/false values fail closed. Keep it false until the separately deferred provider decision is approved. The gate is checked before quota reservation and again at the provider boundary, including legacy direct generation URLs. Provider file deletion remains available when AI is disabled. Manually authored documentation and communication reminders do not depend on this AI gate.

Authenticated admission is separate from daily monetary quota:30 logical AI admissions and20 communication admissions per actor per fixed UTC-minute window. Atomic database counters run before credit reservation. These are logical operation limits, not per-token limits or a sliding-window guarantee; a minute boundary can allow two adjacent bursts. Existing daily reservations still bound monetary admission and are not refunded when paid usage is unknown.

Provider HTTP events include a random operation ID, static operation/model label, elapsed time, HTTP status and an error category. Incomplete/model-schema output emits a failure event against the same operation ID. Logs exclude request/response bodies, keys, URLs, patient/user identifiers and record text. This is local structured provider instrumentation; it does not claim a deployed alerting/metrics backend or full distributed request tracing.

After Auth verifies the bearer token, `requireUser` checks that the decoded subject matches that validated identity. A user with a verified second factor must present `aal2`; malformed claims fail closed. This complements the separately implemented SQL/RLS assurance policies and UI enrollment/session gate.

## Verification and deployment evidence

Targeted tests cover actual discard/export/public-validation handlers, response-body stalls, oversize streams, cancellation, missing/mismatched configuration, provider cleanup failure/retry, unknown upload results, export conflict/streaming, kill switch, PHI-free logging, rate-before-quota ordering and MFA assurance. SQL tests cover immutable issuance, snapshot ownership/change detection, discard late-upload denial, client metadata-deletion denial, export-copy invalidation and admission caps.

The main remediation report records final combined totals. Native Supabase Storage/Auth HTTP, real provider cleanup, a real-browser large archive and hosted backup/restore behavior require staging evidence; mocked boundary tests and disposable PostgreSQL do not prove those external services.

Before deployment, retain `AI_ENABLED=false`, verify the explicit project reference, rehearse all schema migrations on an isolated backend, configure exact allowed origins/redirects and archive expiry cleanup, and exercise synthetic upload interruption/deletion/export/MFA cases. A provider upload lease may be cleared by a service operator only after exact provider reconciliation; never infer a patient's remote file from timing or filename guesses.
